import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type {
  MatrixSweepConfig,
  MatrixSweepSummary,
  MatrixCellDescriptor,
  MatrixCellResult,
  SweepProgress,
  SweepEvent,
  SweepEventListener,
  SweepExecutionStatus,
  IMatrixSweepEngine,
} from "./types.js";
import { MultiProviderRateLimiter } from "./token-bucket.js";
import { CheckpointLedger } from "./checkpoint.js";
import { ScenarioRunnerEngine } from "../runner/runner-engine.js";
import { ScenarioLoader } from "../runner/scenario-loader.js";
import { TelemetryDatabase } from "../reporting/db.js";
import { createProviderAdapter } from "../providers/factory.js";
import type { ScenarioResult, ExecutionLimits } from "../runner/types.js";
import type { IContainerInstance } from "../infrastructure/container/types.js";
import { createDisposableWorkspace } from "../infrastructure/workspace/disposable-workspace.js";
import { createRunArtifactLayout, prepareRunArtifactLayout } from "../infrastructure/workspace/run-artifact-layout.js";
import { createTerminalRunRecord, mapTerminalStatus, writeRunManifest, writeRunResult } from "./run-evidence.js";
export class MatrixSweepEngine implements IMatrixSweepEngine {
  public readonly sweepId: string;
  public status: SweepExecutionStatus = "pending";
  private readonly listeners: Set<SweepEventListener> = new Set();
  private abortController = new AbortController();
  private isPaused = false;
  private pausePromise = Promise.resolve();
  private resumeResolver: (() => void) | null = null;
  private totalCells = 0;
  private completedCount = 0;
  private failedCount = 0;
  private skippedCount = 0;
  private inFlightCount = 0;
  private totalTokensConsumed = 0;
  private totalCostUSD = 0;
  private totalCellDurationMs = 0;
  private startTimeMs = 0;
  constructor(sweepId?: string) {
    this.sweepId = sweepId ?? `sweep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }
  on(listener: SweepEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emitEvent(event: Omit<SweepEvent, "sweepId" | "timestamp" | "progress">): void {
    const fullEvent: SweepEvent = { ...event, sweepId: this.sweepId, timestamp: new Date().toISOString(), progress: this.getProgress() };
    for (const listener of this.listeners) {
      try { void listener(fullEvent); } catch {}
    }
  }
  getProgress(): SweepProgress {
    const elapsedMs = this.startTimeMs > 0 ? Date.now() - this.startTimeMs : 0;
    const finished = this.completedCount + this.failedCount + this.skippedCount;
    const percentage = this.totalCells > 0 ? (finished / this.totalCells) * 100 : 0;
    const avgDur = finished > 0 ? this.totalCellDurationMs / finished : 0;
    const remaining = Math.max(0, this.totalCells - finished);
    return {
      sweepId: this.sweepId,
      totalCells: this.totalCells,
      completedCells: this.completedCount,
      failedCells: this.failedCount,
      skippedCells: this.skippedCount,
      inFlightCells: this.inFlightCount,
      queuedCells: Math.max(0, this.totalCells - finished - this.inFlightCount),
      percentage: Number(percentage.toFixed(2)),
      elapsedMs,
      estimatedRemainingMs: Math.round(remaining * (avgDur > 0 ? avgDur : 5000)),
      totalTokensConsumed: this.totalTokensConsumed,
      totalCostUSD: Number(this.totalCostUSD.toFixed(4)),
      averageCellDurationMs: Math.round(avgDur),
    };
  }
  async pause(): Promise<void> {
    if (this.isPaused || this.status !== "running") return;
    this.isPaused = true;
    this.status = "paused";
    this.pausePromise = new Promise<void>((res) => { this.resumeResolver = res; });
    this.emitEvent({ type: "sweep:pause", message: `Sweep ${this.sweepId} paused` });
  }
  async resume(): Promise<void> {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.status = "running";
    if (this.resumeResolver) { this.resumeResolver(); this.resumeResolver = null; }
    this.pausePromise = Promise.resolve();
    this.emitEvent({ type: "sweep:resume", message: `Sweep ${this.sweepId} resumed` });
  }
  async abort(reason = "Aborted by user"): Promise<void> {
    this.status = "aborted";
    this.abortController.abort(new Error(reason));
    if (this.resumeResolver) { this.resumeResolver(); this.resumeResolver = null; }
    this.emitEvent({ type: "sweep:abort", message: `Sweep ${this.sweepId} aborted: ${reason}` });
  }
  private generateCells(config: MatrixSweepConfig): readonly MatrixCellDescriptor[] {
    const reps = config.repetitions ?? 1;
    const limits: ExecutionLimits = {
      maxTurns: 10,
      maxWallClockTimeMs: 120000,
      maxCostUSD: 0.5,
      maxConsecutiveToolFailures: 3,
      toolTimeoutMs: 30000,
      maxOutputSizeBytes: 1024 * 1024,
      ...config.defaultExecutionLimits,
    };
    const cells: MatrixCellDescriptor[] = [];
    const thinkingLevels = config.thinkingLevels !== undefined && config.thinkingLevels.length > 0
      ? config.thinkingLevels
      : [undefined];
    for (const scenarioId of config.scenarioIds) {
      for (const skillId of config.skillIds) {
        for (const modelEntry of config.models) {
          for (const thinkingLevel of thinkingLevels) {
            for (let rep = 0; rep < reps; rep++) {
              const effectiveThinking = thinkingLevel !== undefined ? thinkingLevel : modelEntry.thinkingLevel;
              const thinkSuffix = effectiveThinking !== undefined ? `_th_${effectiveThinking}` : "";
              const cellId = `${scenarioId}_${skillId}_${modelEntry.modelId}${thinkSuffix}_rep${rep}`;
              cells.push({
                cellId, scenarioId, skillId,
                modelId: modelEntry.modelId, providerId: modelEntry.providerId,
                executionMode: config.runtimeConfig.executionMode,
                outputRoot: config.runtimeConfig.outputRoot,
                thinkingLevel: effectiveThinking,
                thinkingBudget: modelEntry.thinkingBudget,
                repetitionIndex: rep, runId: `run-${this.sweepId}-${cellId}`,
                modelEntry, limits, temperature: modelEntry.temperature,
                tags: modelEntry.tags, metadata: modelEntry.metadata,
              });
            }
          }
        }
      }
    }
    return cells;
  }
  async run(config: MatrixSweepConfig): Promise<MatrixSweepSummary> {
    const startedAt = new Date().toISOString();
    this.startTimeMs = Date.now();
    this.status = "running";
    this.abortController = new AbortController();
    if (config.listeners) for (const l of config.listeners) this.on(l);
    const scenarioLoader = new ScenarioLoader();
    const runnerEngine = new ScenarioRunnerEngine();
    const rateLimiterManager = new MultiProviderRateLimiter(config.rateLimits ?? []);
    const checkpointPath = config.checkpoint?.filePath
      ?? join(config.runtimeConfig.outputRoot, "sweeps", this.sweepId, "checkpoint.json");
    const allPlannedCells = this.generateCells(config);
    this.totalCells = allPlannedCells.length;
    const checkpointLedger = new CheckpointLedger(checkpointPath, {
      sweepId: this.sweepId,
      scenarioIds: config.scenarioIds,
      skillIds: config.skillIds,
      modelIds: config.models.map((m) => m.modelId),
      repetitions: config.repetitions ?? 1,
      totalPlannedCells: this.totalCells,
    }, config.checkpoint);
    if (config.checkpoint?.autoResume) await checkpointLedger.load();
    const telemetryDbPath = config.telemetryDbPath
      ?? join(config.runtimeConfig.outputRoot, "db", "benchmarks.sqlite");
    await mkdir(join(config.runtimeConfig.outputRoot, "db"), { recursive: true });
    const telemetryDb = new TelemetryDatabase(telemetryDbPath);
    try {
    this.emitEvent({
      type: "sweep:start",
      message: `Starting matrix sweep ${this.sweepId} with ${this.totalCells} cells`,
      payload: { totalCells: this.totalCells },
    });
    const maxGlobal = config.concurrency?.maxGlobalConcurrency ?? 4;
    const results: MatrixCellResult[] = [];
    const cellQueue = [...allPlannedCells];
    const modelInFlight = new Map<string, number>();
    const providerInFlight = new Map<string, number>();
    const executeCell = async (cell: MatrixCellDescriptor): Promise<MatrixCellResult> => {
      if (checkpointLedger.isCellCompleted(cell.cellId)) {
        this.skippedCount += 1;
        const res: MatrixCellResult = { cell, status: "skipped", attemptCount: 0, durationMs: 0, retryable: false };
        results.push(res);
        this.emitEvent({ type: "cell:skip", cellId: cell.cellId, message: `Skipping ${cell.cellId}` });
        return res;
      }
      this.inFlightCount += 1;
      modelInFlight.set(cell.modelId, (modelInFlight.get(cell.modelId) ?? 0) + 1);
      providerInFlight.set(cell.providerId, (providerInFlight.get(cell.providerId) ?? 0) + 1);
      this.emitEvent({ type: "cell:start", cellId: cell.cellId, message: `Running ${cell.cellId}` });
      const maxRetries = config.maxRetriesPerCell ?? 2;
      let attempt = 0;
      let lastError: string | undefined;
      let durationMs = 0;
      let scenarioResult: ScenarioResult | undefined;
      let container: IContainerInstance | undefined;
      const limiter = rateLimiterManager.getLimiter(cell.providerId, cell.modelId);
      const cellStartTime = Date.now();
      const scenarioDefinition = scenarioLoader.loadScenario(cell.scenarioId);
      const artifactLayout = await prepareRunArtifactLayout(
        createRunArtifactLayout(cell.outputRoot, cell.runId)
      );
      const evidenceContext = {
        runId: cell.runId,
        scenarioId: cell.scenarioId,
        category: scenarioDefinition.category,
        skillId: cell.skillId,
        modelId: cell.modelId,
        providerId: cell.providerId,
        executionMode: cell.executionMode,
        simulated: cell.executionMode === "fake",
        startedAt: new Date(cellStartTime).toISOString(),
      } as const;
      await writeRunManifest(artifactLayout, evidenceContext);
      const workspace = await createDisposableWorkspace({
        outputRoot: cell.outputRoot,
        runId: cell.runId,
        scenarioId: cell.scenarioId,
        fixtures: scenarioDefinition.workspace?.fixtures ?? {},
      });
      while (attempt <= maxRetries) {
        attempt += 1;
        try {
          if (this.isPaused) await this.pausePromise;
          if (this.abortController.signal.aborted) throw new Error("Sweep aborted");
          await limiter.acquire(2000, this.abortController.signal);
          if (config.containerPool) {
            container = await config.containerPool.acquire({
              imageTag: "skill-benchmarks-sandbox:latest",
              runId: cell.runId, scenarioId: cell.scenarioId,
              resourceLimits: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
              networkMode: "sb-bridge-isolated",
              workspaceVolumeName: `sb-vol-${cell.runId}`,
              artifactHostPath: artifactLayout.runDirectory,
              timeouts: { commandTimeoutMs: cell.limits.toolTimeoutMs, turnTimeoutMs: 60000, totalScenarioTimeoutMs: cell.limits.maxWallClockTimeMs },
              labels: { "io.skill-benchmarks.sweep-id": this.sweepId },
            });
          }
          if (config.dryRun) {
            durationMs = 50 + Math.floor(Math.random() * 50);
            scenarioResult = {
              runId: cell.runId, scenarioId: cell.scenarioId, skillIds: [cell.skillId], modelId: cell.modelId,
              executionMode: "fake", simulated: true,
              terminationReason: "success", completed: true, turns: 2, turnHistory: [], toolHistory: [], messages: [],
              finalOutput: "Dry run completed", totalDurationMs: durationMs,
              totalTokens: { inputTokens: 500, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, totalTokens: 700 },
              totalCostUSD: 0, consecutiveToolErrors: 0,
              startedAt: new Date(Date.now() - durationMs).toISOString(), finishedAt: new Date().toISOString(),
            };
          } else {
            const provider = cell.modelEntry.provider ?? createProviderAdapter({
              providerId: config.runtimeConfig.requestedProviderId ?? (cell.providerId as "anthropic" | "google" | "openai" | "ollama" | "custom"),
              defaultModel: cell.modelId,
              executionMode: config.runtimeConfig.executionMode,
              runId: cell.runId,
            });
            scenarioResult = await runnerEngine.run({
              runId: cell.runId, scenarioId: cell.scenarioId, skillIds: [cell.skillId], modelId: cell.modelId,
              provider, prompt: scenarioDefinition.instructions,
              workspace,
              container, limits: cell.limits, temperature: cell.temperature,
              thinkingLevel: cell.thinkingLevel,
              thinkingBudget: cell.thinkingBudget,
              reasoningEffort: cell.modelEntry.reasoningEffort,
            });
            durationMs = scenarioResult.totalDurationMs;
          }
          limiter.recordConsumption(scenarioResult.totalTokens.totalTokens);
          if (!scenarioResult.completed) {
            lastError = scenarioResult.errorMessage ?? scenarioResult.terminationReason;
            break;
          }
          const terminal = {
            status: mapTerminalStatus(scenarioResult.terminationReason),
            terminationReason: scenarioResult.terminationReason,
            completedAt: scenarioResult.finishedAt,
          } as const;
          const runRecord = createTerminalRunRecord(evidenceContext, terminal, scenarioResult);
          telemetryDb.saveRunRecord(runRecord);
          await writeRunResult(artifactLayout, evidenceContext, terminal, scenarioResult);
          const cellResult: MatrixCellResult = {
            cell, status: "completed", attemptCount: attempt,
            startedAt: new Date(cellStartTime).toISOString(), completedAt: new Date().toISOString(),
            durationMs, scenarioResult, runRecord, retryable: false,
          };
          await checkpointLedger.recordCellSuccess(cellResult);
          this.completedCount += 1;
          this.totalTokensConsumed += scenarioResult.totalTokens.totalTokens;
          this.totalCostUSD += scenarioResult.totalCostUSD;
          this.totalCellDurationMs += durationMs;
          results.push(cellResult);
          this.emitEvent({
            type: "cell:complete", cellId: cell.cellId,
            message: `Cell ${cell.cellId} completed in ${durationMs}ms`,
            payload: { durationMs, costUSD: scenarioResult.totalCostUSD },
          });
          return cellResult;
        } catch (err) {
          lastError = (err as Error).message;
          if (attempt <= maxRetries && !this.abortController.signal.aborted) {
            this.emitEvent({ type: "cell:retry", cellId: cell.cellId, message: `Retrying ${cell.cellId}: ${lastError}` });
            await limiter.reportRateLimitViolation();
          }
        } finally {
          if (container && config.containerPool) {
            await config.containerPool.release(container);
            container = undefined;
          }
        }
      }
      const terminationReason = scenarioResult?.terminationReason
        ?? (this.abortController.signal.aborted ? "aborted" : "error");
      const terminal = {
        status: mapTerminalStatus(terminationReason),
        terminationReason,
        completedAt: scenarioResult?.finishedAt ?? new Date().toISOString(),
        ...(lastError === undefined ? {} : { error: lastError }),
      } as const;
      const runRecord = createTerminalRunRecord(evidenceContext, terminal, scenarioResult);
      telemetryDb.saveRunRecord(runRecord);
      await writeRunResult(artifactLayout, evidenceContext, terminal, scenarioResult);
      this.failedCount += 1;
      const failedResult: MatrixCellResult = {
        cell, status: "failed", attemptCount: attempt,
        durationMs: scenarioResult?.totalDurationMs ?? Date.now() - cellStartTime,
        scenarioResult, runRecord, error: lastError, retryable: false,
      };
      await checkpointLedger.recordCellFailure(failedResult);
      results.push(failedResult);
      this.emitEvent({ type: "cell:error", cellId: cell.cellId, message: `Cell ${cell.cellId} failed: ${lastError}` });
      if (config.stopOnFirstFailure) await this.abort(`Stopped on first failure: ${lastError}`);
      return failedResult;
    };
    const workerPool: Promise<void>[] = [];
    const runWorker = async (): Promise<void> => {
      while (cellQueue.length > 0 && !this.abortController.signal.aborted) {
        if (this.isPaused) await this.pausePromise;
        const idx = cellQueue.findIndex((c) => {
          const mInf = modelInFlight.get(c.modelId) ?? 0;
          const pInf = providerInFlight.get(c.providerId) ?? 0;
          const maxM = c.modelEntry.concurrencyLimit ?? config.concurrency?.maxPerModelConcurrency ?? 10;
          const maxP = config.concurrency?.maxPerProviderConcurrency ?? 20;
          return mInf < maxM && pInf < maxP;
        });
        if (idx === -1) {
          await new Promise((res) => setTimeout(res, 50));
          continue;
        }
        const cell = cellQueue.splice(idx, 1)[0];
        if (!cell) continue;
        try {
          await executeCell(cell);
        } finally {
          this.inFlightCount = Math.max(0, this.inFlightCount - 1);
          modelInFlight.set(cell.modelId, Math.max(0, (modelInFlight.get(cell.modelId) ?? 1) - 1));
          providerInFlight.set(cell.providerId, Math.max(0, (providerInFlight.get(cell.providerId) ?? 1) - 1));
        }
      }
    };
    const activeWorkers = Math.min(maxGlobal, allPlannedCells.length);
    for (let i = 0; i < activeWorkers; i++) workerPool.push(runWorker());
    await Promise.all(workerPool);
    const completedAt = new Date().toISOString();
    const totalDurationMs = Date.now() - this.startTimeMs;
    this.status = this.abortController.signal.aborted ? "aborted" : this.failedCount > 0 ? "failed" : "completed";
    const summary: MatrixSweepSummary = {
      sweepId: this.sweepId,
      status: this.status,
      totalCells: this.totalCells,
      completedCount: this.completedCount,
      failedCount: this.failedCount,
      skippedCount: this.skippedCount,
      totalDurationMs,
      totalCostUSD: Number(this.totalCostUSD.toFixed(4)),
      totalTokens: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, totalTokens: this.totalTokensConsumed },
      detailedTokens: { uncachedInputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, totalInputTokens: 0, completionOutputTokens: 0, reasoningOutputTokens: 0, totalOutputTokens: 0, grandTotalTokens: this.totalTokensConsumed },
      results,
      startedAt,
      completedAt,
    };
    this.emitEvent({
      type: "sweep:complete",
      message: `Sweep ${this.sweepId} completed: ${this.completedCount} passed, ${this.failedCount} failed in ${totalDurationMs}ms`,
      payload: { totalCostUSD: summary.totalCostUSD, totalDurationMs },
    });
      return summary;
    } finally {
      telemetryDb.close();
    }
  }
}

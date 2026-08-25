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
import type { ExecutionLimits } from "../runner/types.js";
import { createSafeArtifactPathSegment } from "../shared/artifact-sanitization.js";
import { executeSweepCell } from "./cell-execution.js";
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
    this.sweepId = createSafeArtifactPathSegment(sweepId ?? `sweep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, "sweep");
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
              const artifactModelId = createSafeArtifactPathSegment(modelEntry.modelId, "model");
              const cellId = `${scenarioId}_${skillId}_${artifactModelId}${thinkSuffix}_rep${rep}`;
              cells.push({
                cellId, scenarioId, skillId,
                modelId: modelEntry.modelId, providerId: config.runtimeConfig.requestedProviderId ?? modelEntry.providerId,
                executionMode: config.runtimeConfig.executionMode,
                outputRoot: config.runtimeConfig.outputRoot,
                thinkingLevel: effectiveThinking,
                thinkingBudget: modelEntry.thinkingBudget,
                repetitionIndex: rep, runId: createSafeArtifactPathSegment(`run-${this.sweepId}-${cellId}`, "run"),
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
    const recordCellResult = async (result: MatrixCellResult): Promise<MatrixCellResult> => {
      results.push(result);
      this.totalCellDurationMs += result.durationMs;
      if (result.executionCompleted) {
        await checkpointLedger.recordCellSuccess(result);
        this.completedCount += 1;
        this.totalTokensConsumed += result.scenarioResult?.totalTokens.totalTokens ?? 0;
        this.totalCostUSD += result.scenarioResult?.totalCostUSD ?? 0;
        this.emitEvent({
          type: "cell:complete",
          cellId: result.cell.cellId,
          message: `Cell ${result.cell.cellId} completed in ${result.durationMs}ms`,
          payload: { durationMs: result.durationMs, costUSD: result.scenarioResult?.totalCostUSD ?? 0, passedBenchmark: result.passedBenchmark },
        });
      } else {
        await checkpointLedger.recordCellFailure(result);
        this.failedCount += 1;
        this.emitEvent({ type: "cell:error", cellId: result.cell.cellId, message: `Cell ${result.cell.cellId} ${result.error ?? "execution failed"}` });
        if (config.stopOnFirstFailure && !this.abortController.signal.aborted) await this.abort("Stopped on first failure");
      }
      return result;
    };
    const executeCell = async (cell: MatrixCellDescriptor): Promise<MatrixCellResult> => {
      if (checkpointLedger.isCellCompleted(cell.cellId)) {
        this.skippedCount += 1;
        const res: MatrixCellResult = { cell, status: "skipped", attemptCount: 0, durationMs: 0, executionCompleted: false, passedBenchmark: false, retryable: false };
        results.push(res);
        this.emitEvent({ type: "cell:skip", cellId: cell.cellId, message: `Skipping ${cell.cellId}` });
        return res;
      }
      this.inFlightCount += 1;
      modelInFlight.set(cell.modelId, (modelInFlight.get(cell.modelId) ?? 0) + 1);
      providerInFlight.set(cell.providerId, (providerInFlight.get(cell.providerId) ?? 0) + 1);
      this.emitEvent({ type: "cell:start", cellId: cell.cellId, message: `Running ${cell.cellId}` });
      const limiter = rateLimiterManager.getLimiter(cell.providerId, cell.modelId);
      return recordCellResult(await executeSweepCell({
        cell,
        config,
        scenarioLoader,
        runnerEngine,
        telemetryDb,
        limiter,
        aborted: () => this.abortController.signal.aborted,
      }));
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
    while (cellQueue.length > 0) {
      const queuedCell = cellQueue.shift();
      if (queuedCell === undefined) continue;
      await executeCell(queuedCell);
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      modelInFlight.set(queuedCell.modelId, Math.max(0, (modelInFlight.get(queuedCell.modelId) ?? 1) - 1));
      providerInFlight.set(queuedCell.providerId, Math.max(0, (providerInFlight.get(queuedCell.providerId) ?? 1) - 1));
    }
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
      message: `Sweep ${this.sweepId} completed: ${this.completedCount} executed, ${this.failedCount} failed in ${totalDurationMs}ms`,
      payload: { totalCostUSD: summary.totalCostUSD, totalDurationMs },
    });
      return summary;
    } finally {
      telemetryDb.close();
    }
  }
}

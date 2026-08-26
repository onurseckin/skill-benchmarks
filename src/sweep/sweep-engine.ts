import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { IMatrixSweepEngine, MatrixCellDescriptor, MatrixCellResult, MatrixSweepConfig, MatrixSweepSummary, SweepEvent, SweepEventListener, SweepExecutionStatus, SweepProgress } from "./types.js";
import { MultiProviderRateLimiter } from "./token-bucket.js";
import { ScenarioRunnerEngine } from "../runner/runner-engine.js";
import { ScenarioLoader } from "../runner/scenario-loader.js";
import { TelemetryDatabase } from "../reporting/db.js";
import { createSafeArtifactPathSegment } from "../shared/artifact-sanitization.js";
import { executeSweepCell } from "./cell-execution.js";
import { terminalizeAbortedSweepCell } from "./aborted-cell-terminalization.js";
import { acquireSweepLease } from "./sweep-lease.js";
import { validateMatrixSweepConfig } from "./sweep-config-validation.js";
import {
  cleanupValidatedTerminalEvidence,
  validateCheckpointTerminalEvidence,
  validateSweepOutcomeEvidence,
} from "./terminal-reconciliation.js";
import { removeCheckpointTemporaryFiles } from "./checkpoint-storage.js";
import {
  createSweepOutcomePath,
  writeDatabasePreflightFailureOutcome,
  writeSweepOutcome,
} from "./sweep-outcome.js";
import { prepareSweepExecution } from "./sweep-preparation.js";
import { createMatrixSweepSummary } from "./sweep-summary.js";
import { runSweepWorkerPool } from "./sweep-worker-pool.js";
import { createSweepProgress, createInitialSweepIdentity, dispatchSweepEvent, resolveSweepIdentity } from "./sweep-engine-state.js";
import { createCheckpointPersistenceFailure, createSkippedSweepCellResult } from "./sweep-cell-results.js";
export class MatrixSweepEngine implements IMatrixSweepEngine {
  public sweepId: string;
  private readonly constructorSweepId?: string;
  public status: SweepExecutionStatus = "pending";
  private readonly listeners: Set<SweepEventListener> = new Set();
  private abortController = new AbortController();
  private isPaused = false;
  private pausePromise = Promise.resolve();
  private resumeResolver: (() => void) | null = null;
  private totalCells = 0;
  private completedCount = 0;
  private failedCount = 0;
  private abortedCount = 0;
  private skippedCount = 0;
  private inFlightCount = 0;
  private totalTokensConsumed = 0;
  private totalCostUSD = 0;
  private totalCellDurationMs = 0;
  private startTimeMs = 0;
  constructor(sweepId?: string) {
    const identity = createInitialSweepIdentity(sweepId);
    this.constructorSweepId = identity.constructorSweepId;
    this.sweepId = identity.sweepId;
  }
  on(listener: SweepEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emitEvent(event: Omit<SweepEvent, "sweepId" | "timestamp" | "progress">): void {
    dispatchSweepEvent(this.listeners, this.sweepId, this.getProgress(), event);
  }
  getProgress(): SweepProgress {
    return createSweepProgress({
      sweepId: this.sweepId,
      totalCells: this.totalCells,
      completedCount: this.completedCount,
      failedCount: this.failedCount,
      abortedCount: this.abortedCount,
      skippedCount: this.skippedCount,
      inFlightCount: this.inFlightCount,
      totalTokensConsumed: this.totalTokensConsumed,
      totalCostUSD: this.totalCostUSD,
      totalCellDurationMs: this.totalCellDurationMs,
      startTimeMs: this.startTimeMs,
    });
  }
  async pause(): Promise<void> {
    if (this.isPaused || this.status !== "running") return;
    this.isPaused = true;
    this.status = "paused";
    this.pausePromise = new Promise<void>((res) => {
      this.resumeResolver = res;
    });
    this.emitEvent({ type: "sweep:pause", message: `Sweep ${this.sweepId} paused` });
  }
  async resume(): Promise<void> {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.status = "running";
    if (this.resumeResolver) {
      this.resumeResolver();
      this.resumeResolver = null;
    }
    this.pausePromise = Promise.resolve();
    this.emitEvent({ type: "sweep:resume", message: `Sweep ${this.sweepId} resumed` });
  }
  async abort(reason = "Aborted by user"): Promise<void> {
    this.status = "aborted";
    this.abortController.abort(new Error(reason));
    if (this.resumeResolver) {
      this.resumeResolver();
      this.resumeResolver = null;
    }
    this.emitEvent({ type: "sweep:abort", message: `Sweep ${this.sweepId} aborted: ${reason}` });
  }
  async run(config: MatrixSweepConfig): Promise<MatrixSweepSummary> {
    try {
      return await this.executeRun(config);
    } catch (error) {
      if (this.status !== "aborted") this.status = "failed";
      this.emitEvent({
        type: this.status === "aborted" ? "sweep:abort" : "sweep:error",
        message: `Sweep ${this.sweepId} ${this.status}`,
        payload: { terminalStatus: this.status },
      });
      throw error;
    }
  }
  private async executeRun(config: MatrixSweepConfig): Promise<MatrixSweepSummary> {
    validateMatrixSweepConfig(config);
    this.applyConfiguredSweepIdentity(config.sweepId);
    const initialStartedAt = new Date().toISOString();
    this.startTimeMs = Date.now();
    this.status = "running";
    this.abortController = new AbortController();
    if (config.listeners) for (const l of config.listeners) this.on(l);
    const scenarioLoader = new ScenarioLoader();
    const runnerEngine = new ScenarioRunnerEngine();
    const rateLimiterManager = new MultiProviderRateLimiter(config.rateLimits ?? []);
    const preparation = await prepareSweepExecution(this.sweepId, config, initialStartedAt);
    const {
      allPlannedCells,
      checkpointLedger,
      checkpointLoaded,
      checkpointPath,
      planFingerprint,
      startedAt,
      telemetryDbPath,
    } = preparation;
    this.totalCells = allPlannedCells.length;
    const sweepLease = await acquireSweepLease(config.runtimeConfig.outputRoot, this.sweepId);
    try {
      await sweepLease.bindPlan(
        this.sweepId,
        planFingerprint,
        config.checkpoint?.autoResume === true,
      );
      let telemetryDb: TelemetryDatabase;
      try {
        await mkdir(join(config.runtimeConfig.outputRoot, "db"), { recursive: true });
        telemetryDb = new TelemetryDatabase(telemetryDbPath, {
          authorityRoot: config.runtimeConfig.outputRoot,
        });
      } catch {
        try {
          writeDatabasePreflightFailureOutcome(
            config.runtimeConfig.outputRoot,
            this.sweepId,
            planFingerprint,
            startedAt,
            allPlannedCells,
          );
        } catch {}
        throw new TypeError("Benchmark database preflight failed");
      }
      try {
        if (config.checkpoint?.autoResume) {
          validateCheckpointTerminalEvidence(
            allPlannedCells,
            checkpointLedger.getState(),
            telemetryDb,
            config,
          );
          validateSweepOutcomeEvidence(
            createSweepOutcomePath(config.runtimeConfig.outputRoot, this.sweepId),
            allPlannedCells,
            checkpointLedger.getState(),
            telemetryDb,
            planFingerprint,
            checkpointLoaded,
          );
          cleanupValidatedTerminalEvidence(allPlannedCells);
          removeCheckpointTemporaryFiles(checkpointPath);
        }
        this.emitEvent({
          type: "sweep:start",
          message: `Starting matrix sweep ${this.sweepId} with ${this.totalCells} cells`,
          payload: { totalCells: this.totalCells },
        });
        const results: MatrixCellResult[] = [];
        const durableRecords = new Map<string, NonNullable<MatrixCellResult["runRecord"]>>();
        let checkpointPersistenceFailed = false;
        let terminalIdentityConflict = false;
        const recordCheckpointFailure = (result: MatrixCellResult): MatrixCellResult => {
          if (result.runRecord !== undefined)
            durableRecords.set(result.cell.cellId, result.runRecord);
          const failedResult = createCheckpointPersistenceFailure(result);
          results.push(failedResult);
          this.failedCount += 1;
          this.emitEvent({
            type: "cell:error",
            cellId: result.cell.cellId,
            message: `Cell ${result.cell.cellId} checkpoint persistence failed`,
          });
          return failedResult;
        };
        const recordCellResult = async (result: MatrixCellResult): Promise<MatrixCellResult> => {
          this.totalCellDurationMs += result.durationMs;
          if (checkpointPersistenceFailed) return recordCheckpointFailure(result);
          if (result.terminalIdentityConflict === true) {
            terminalIdentityConflict = true;
            if (!this.abortController.signal.aborted)
              this.abortController.abort(new Error("terminal identity conflict"));
            results.push(result);
            this.failedCount += 1;
            this.emitEvent({
              type: "cell:error",
              cellId: result.cell.cellId,
              message: `Cell ${result.cell.cellId} terminal identity conflict`,
            });
            return result;
          }
          try {
            if (result.executionCompleted) await checkpointLedger.recordCellSuccess(result);
            else if (result.status === "aborted") await checkpointLedger.recordCellAborted(result);
            else await checkpointLedger.recordCellFailure(result);
          } catch {
            checkpointPersistenceFailed = true;
            if (!this.abortController.signal.aborted)
              this.abortController.abort(new Error("checkpoint persistence failed"));
            return recordCheckpointFailure(result);
          }
          results.push(result);
          if (result.runRecord !== undefined)
            durableRecords.set(result.cell.cellId, result.runRecord);
          if (result.executionCompleted) {
            this.completedCount += 1;
            this.totalTokensConsumed += result.scenarioResult?.totalTokens.totalTokens ?? 0;
            this.totalCostUSD += result.scenarioResult?.totalCostUSD ?? 0;
            this.emitEvent({
              type: "cell:complete",
              cellId: result.cell.cellId,
              message: `Cell ${result.cell.cellId} completed in ${result.durationMs}ms`,
              payload: {
                durationMs: result.durationMs,
                costUSD: result.scenarioResult?.totalCostUSD ?? 0,
                benchmarkCohort: result.benchmarkCohort,
                eligibilityStatus: result.eligibilityStatus,
                evaluationStatus: result.evaluationStatus,
                ...(result.passedBenchmark === undefined
                  ? {}
                  : { passedBenchmark: result.passedBenchmark }),
              },
            });
          } else if (result.status === "aborted") {
            this.abortedCount += 1;
          } else {
            this.failedCount += 1;
            this.emitEvent({
              type: "cell:error",
              cellId: result.cell.cellId,
              message: `Cell ${result.cell.cellId} ${result.error ?? "execution failed"}`,
            });
            if (config.stopOnFirstFailure && !this.abortController.signal.aborted)
              await this.abort("Stopped on first failure");
          }
          return result;
        };
        const executeCell = async (cell: MatrixCellDescriptor): Promise<MatrixCellResult> => {
          if (checkpointLedger.isCellCompleted(cell.cellId)) {
            this.skippedCount += 1;
            const res = createSkippedSweepCellResult(cell);
            results.push(res);
            this.emitEvent({
              type: "cell:skip",
              cellId: cell.cellId,
              message: `Skipping ${cell.cellId}`,
            });
            return res;
          }
          this.emitEvent({
            type: "cell:start",
            cellId: cell.cellId,
            message: `Running ${cell.cellId}`,
          });
          const limiter = rateLimiterManager.getLimiter(cell.providerId, cell.modelId);
          return recordCellResult(
            await executeSweepCell({
              cell,
              config,
              scenarioLoader,
              runnerEngine,
              telemetryDb,
              limiter,
              signal: this.abortController.signal,
              planFingerprint,
            }),
          );
        };
        await runSweepWorkerPool({
          cells: allPlannedCells,
          config,
          maxGlobalConcurrency: config.concurrency?.maxGlobalConcurrency ?? 4,
          signal: this.abortController.signal,
          waitIfPaused: async () => {
            if (this.isPaused) await this.pausePromise;
          },
          shouldSkip: (cell) => checkpointLedger.isCellCompleted(cell.cellId),
          updateInFlight: (delta) => {
            this.inFlightCount = Math.max(0, this.inFlightCount + delta);
          },
          executeCell,
          terminalizeAbortedCell: async (cell) =>
            void (await recordCellResult(
              await terminalizeAbortedSweepCell({ cell, config, telemetryDb, planFingerprint }),
            )),
        });
        const completedAt =
          checkpointPersistenceFailed || terminalIdentityConflict
            ? new Date().toISOString()
            : checkpointLedger.getState().metadata.updatedAt;
        const totalDurationMs = Date.now() - this.startTimeMs;
        this.status =
          checkpointPersistenceFailed || terminalIdentityConflict
            ? "failed"
            : this.abortController.signal.aborted
              ? "aborted"
              : this.failedCount > 0
                ? "failed"
                : "completed";
        const summary = createMatrixSweepSummary({
          sweepId: this.sweepId,
          status: this.status,
          totalCells: this.totalCells,
          completedCount: this.completedCount,
          failedCount: this.failedCount,
          abortedCount: this.abortedCount,
          skippedCount: this.skippedCount,
          totalDurationMs,
          totalCostUSD: this.totalCostUSD,
          totalTokensConsumed: this.totalTokensConsumed,
          results,
          startedAt,
          completedAt,
        });
        if (!checkpointLoaded) {
          writeSweepOutcome({
            outputRoot: config.runtimeConfig.outputRoot,
            sweepId: this.sweepId,
            planFingerprint,
            status: this.status,
            startedAt,
            completedAt,
            cells: allPlannedCells,
            results,
            durableRecords,
            ...(checkpointPersistenceFailed
              ? { orchestrationFailure: "checkpoint_persistence_failed" as const }
              : terminalIdentityConflict
                ? { orchestrationFailure: "terminal_identity_conflict" as const }
                : {}),
          });
        }
        this.emitEvent({
          type:
            this.status === "completed"
              ? "sweep:complete"
              : this.status === "aborted"
                ? "sweep:abort"
                : "sweep:error",
          message: `Sweep ${this.sweepId} ${this.status}: ${this.completedCount} executed, ${this.abortedCount} aborted, ${this.failedCount} failed in ${totalDurationMs}ms`,
          payload: {
            totalCostUSD: summary.totalCostUSD,
            totalDurationMs,
            terminalStatus: this.status,
          },
        });
        return summary;
      } finally {
        telemetryDb.close();
      }
    } finally {
      await sweepLease.release();
    }
  }
  private applyConfiguredSweepIdentity(configuredSweepId: string | undefined): void {
    if (configuredSweepId === undefined) return;
    this.sweepId = resolveSweepIdentity(this.constructorSweepId, configuredSweepId, (value) =>
      createSafeArtifactPathSegment(value, "sweep"),
    );
  }
}

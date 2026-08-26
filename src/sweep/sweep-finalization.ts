import type { RunRecord } from "../reporting/types.js";
import { writeSweepOutcome } from "./sweep-outcome.js";
import { createMatrixSweepSummary } from "./sweep-summary.js";
import type {
  MatrixCellDescriptor,
  MatrixCellResult,
  MatrixSweepSummary,
  SweepEvent,
  SweepExecutionStatus,
} from "./types.js";

export interface SweepFinalizationInput {
  readonly outputRoot: string;
  readonly sweepId: string;
  readonly planFingerprint: string;
  readonly startedAt: string;
  readonly startTimeMs: number;
  readonly checkpointLoaded: boolean;
  readonly checkpointUpdatedAt: string;
  readonly checkpointPersistenceFailed: boolean;
  readonly terminalIdentityConflict: boolean;
  readonly abortRequested: boolean;
  readonly totalCells: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly abortedCount: number;
  readonly skippedCount: number;
  readonly totalCostUSD: number;
  readonly totalTokensConsumed: number;
  readonly cells: readonly MatrixCellDescriptor[];
  readonly results: readonly MatrixCellResult[];
  readonly durableRecords: ReadonlyMap<string, RunRecord>;
}

export interface SweepFinalizationResult {
  readonly status: SweepExecutionStatus;
  readonly summary: MatrixSweepSummary;
  readonly event: Omit<SweepEvent, "sweepId" | "timestamp" | "progress">;
}

export function finalizeSweepExecution(input: SweepFinalizationInput): SweepFinalizationResult {
  const orchestrationFailed = input.checkpointPersistenceFailed || input.terminalIdentityConflict;
  const completedAt = orchestrationFailed ? new Date().toISOString() : input.checkpointUpdatedAt;
  const totalDurationMs = Date.now() - input.startTimeMs;
  const status = resolveTerminalStatus(input, orchestrationFailed);
  const summary = createMatrixSweepSummary({
    sweepId: input.sweepId,
    status,
    totalCells: input.totalCells,
    completedCount: input.completedCount,
    failedCount: input.failedCount,
    abortedCount: input.abortedCount,
    skippedCount: input.skippedCount,
    totalDurationMs,
    totalCostUSD: input.totalCostUSD,
    totalTokensConsumed: input.totalTokensConsumed,
    results: input.results,
    startedAt: input.startedAt,
    completedAt,
  });
  if (!input.checkpointLoaded) {
    writeSweepOutcome({
      outputRoot: input.outputRoot,
      sweepId: input.sweepId,
      planFingerprint: input.planFingerprint,
      status,
      startedAt: input.startedAt,
      completedAt,
      cells: input.cells,
      results: input.results,
      durableRecords: input.durableRecords,
      ...(input.checkpointPersistenceFailed
        ? { orchestrationFailure: "checkpoint_persistence_failed" as const }
        : input.terminalIdentityConflict
          ? { orchestrationFailure: "terminal_identity_conflict" as const }
          : {}),
    });
  }
  return {
    status,
    summary,
    event: {
      type:
        status === "completed"
          ? "sweep:complete"
          : status === "aborted"
            ? "sweep:abort"
            : "sweep:error",
      message: `Sweep ${input.sweepId} ${status}: ${input.completedCount} executed, ${input.abortedCount} aborted, ${input.failedCount} failed in ${totalDurationMs}ms`,
      payload: {
        totalCostUSD: summary.totalCostUSD,
        totalDurationMs,
        terminalStatus: status,
      },
    },
  };
}

function resolveTerminalStatus(
  input: SweepFinalizationInput,
  orchestrationFailed: boolean,
): SweepExecutionStatus {
  if (orchestrationFailed) return "failed";
  if (input.abortRequested) return "aborted";
  if (input.failedCount > 0) return "failed";
  return "completed";
}

import type { MatrixCellResult, MatrixSweepSummary, SweepExecutionStatus } from "./types.js";

export interface SweepSummaryInput {
  readonly sweepId: string;
  readonly status: SweepExecutionStatus;
  readonly totalCells: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly totalDurationMs: number;
  readonly totalCostUSD: number;
  readonly totalTokensConsumed: number;
  readonly results: readonly MatrixCellResult[];
  readonly startedAt: string;
  readonly completedAt: string;
}

export function createMatrixSweepSummary(input: SweepSummaryInput): MatrixSweepSummary {
  return {
    sweepId: input.sweepId,
    status: input.status,
    totalCells: input.totalCells,
    completedCount: input.completedCount,
    failedCount: input.failedCount,
    skippedCount: input.skippedCount,
    totalDurationMs: input.totalDurationMs,
    totalCostUSD: Number(input.totalCostUSD.toFixed(4)),
    totalTokens: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: input.totalTokensConsumed,
    },
    detailedTokens: {
      uncachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalInputTokens: 0,
      completionOutputTokens: 0,
      reasoningOutputTokens: 0,
      totalOutputTokens: 0,
      grandTotalTokens: input.totalTokensConsumed,
    },
    results: input.results,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  };
}

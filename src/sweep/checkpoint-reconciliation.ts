import { isDeepStrictEqual } from "node:util";
import type { TokenUsage } from "../runner/types.js";
import { checkpointMetadataVersion } from "./checkpoint.js";
import { createModelEntryPlanIdentity } from "./sweep-plan.js";
import type {
  CheckpointState,
  MatrixCellDescriptor,
  MatrixCellResult,
  MatrixSweepConfig,
  SweepExecutionStatus,
} from "./types.js";

interface CheckpointCellSets {
  readonly completedIds: ReadonlySet<string>;
  readonly failedIds: ReadonlySet<string>;
  readonly skippedIds: ReadonlySet<string>;
  readonly terminalIds: ReadonlySet<string>;
}

export function validateCheckpointStateContract(
  cells: readonly MatrixCellDescriptor[],
  checkpoint: CheckpointState,
  config: MatrixSweepConfig,
  fail: () => never,
): CheckpointCellSets {
  const completedIds = new Set(checkpoint.completedCellIds);
  const failedIds = new Set(checkpoint.failedCellIds);
  const skippedIds = new Set(checkpoint.skippedCellIds);
  const terminalIds = new Set([...completedIds, ...failedIds]);
  const trackedIds = new Set([...terminalIds, ...skippedIds]);
  const resultIds = Object.keys(checkpoint.completedResults);
  if (
    checkpoint.metadata.version !== checkpointMetadataVersion ||
    checkpoint.metadata.sweepId !== cells[0]?.sweepId ||
    checkpoint.totalPlannedCells !== cells.length ||
    !isDeepStrictEqual(checkpoint.configSummary, expectedConfigSummary(config)) ||
    completedIds.size !== checkpoint.completedCellIds.length ||
    failedIds.size !== checkpoint.failedCellIds.length ||
    skippedIds.size !== checkpoint.skippedCellIds.length ||
    [...completedIds].some((cellId) => failedIds.has(cellId) || skippedIds.has(cellId)) ||
    [...failedIds].some((cellId) => skippedIds.has(cellId)) ||
    resultIds.length !== trackedIds.size ||
    resultIds.some((cellId) => !trackedIds.has(cellId)) ||
    checkpoint.status !== expectedCheckpointStatus(checkpoint, terminalIds, failedIds, skippedIds)
  )
    fail();
  const cellsById = new Map(cells.map((cell) => [cell.cellId, cell]));
  for (const cellId of trackedIds) {
    const cell = cellsById.get(cellId);
    const result = checkpoint.completedResults[cellId];
    if (cell === undefined || result === undefined || !sameMatrixCellDescriptor(result.cell, cell))
      fail();
    if (skippedIds.has(cellId) && !isCanonicalSkippedResult(result)) fail();
  }
  validateCheckpointAggregates(checkpoint, completedIds, failedIds, fail);
  return { completedIds, failedIds, skippedIds, terminalIds };
}

export function sameMatrixCellDescriptor(
  checkpointCell: MatrixCellDescriptor,
  cell: MatrixCellDescriptor,
): boolean {
  return (
    checkpointCell.sweepId === cell.sweepId &&
    checkpointCell.cellId === cell.cellId &&
    checkpointCell.runId === cell.runId &&
    checkpointCell.matrixOccurrenceIndex === cell.matrixOccurrenceIndex &&
    checkpointCell.scenarioId === cell.scenarioId &&
    checkpointCell.skillId === cell.skillId &&
    checkpointCell.modelId === cell.modelId &&
    checkpointCell.providerId === cell.providerId &&
    checkpointCell.executionMode === cell.executionMode &&
    checkpointCell.outputRoot === cell.outputRoot &&
    checkpointCell.repetitionIndex === cell.repetitionIndex &&
    checkpointCell.thinkingLevel === cell.thinkingLevel &&
    checkpointCell.thinkingBudget === cell.thinkingBudget &&
    checkpointCell.temperature === cell.temperature &&
    isDeepStrictEqual(checkpointCell.limits, cell.limits) &&
    isDeepStrictEqual(checkpointCell.tags, cell.tags) &&
    isDeepStrictEqual(checkpointCell.metadata, cell.metadata) &&
    isDeepStrictEqual(
      createModelEntryPlanIdentity(checkpointCell.modelEntry),
      createModelEntryPlanIdentity(cell.modelEntry),
    )
  );
}

function expectedConfigSummary(config: MatrixSweepConfig): CheckpointState["configSummary"] {
  return {
    scenarioIds: config.scenarioIds,
    skillIds: config.skillIds,
    modelIds: config.models.map((model) => model.modelId),
    repetitions: config.repetitions ?? 1,
  };
}

function expectedCheckpointStatus(
  checkpoint: CheckpointState,
  terminalIds: ReadonlySet<string>,
  failedIds: ReadonlySet<string>,
  skippedIds: ReadonlySet<string>,
): SweepExecutionStatus {
  if (terminalIds.size + skippedIds.size < checkpoint.totalPlannedCells) {
    return terminalIds.size + skippedIds.size === 0 ? "pending" : "running";
  }
  if (failedIds.size === 0) return "completed";
  const allFailuresAborted = [...failedIds].every(
    (cellId) => checkpoint.completedResults[cellId]?.runRecord?.terminationReason === "aborted",
  );
  return allFailuresAborted ? "aborted" : "failed";
}

function validateCheckpointAggregates(
  checkpoint: CheckpointState,
  completedIds: ReadonlySet<string>,
  failedIds: ReadonlySet<string>,
  fail: () => never,
): void {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let totalTokens = 0;
  let expectedCost = 0;
  let expectedDuration = 0;
  for (const cellId of checkpoint.completedCellIds) {
    const result = checkpoint.completedResults[cellId];
    if (result === undefined || result.scenarioResult === undefined) fail();
    const usage = result.scenarioResult.totalTokens;
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    cacheCreationInputTokens += usage.cacheCreationInputTokens;
    cacheReadInputTokens += usage.cacheReadInputTokens;
    totalTokens += usage.totalTokens;
    expectedCost += result.scenarioResult.totalCostUSD;
    expectedDuration += result.durationMs;
  }
  for (const cellId of checkpoint.failedCellIds) {
    const result = checkpoint.completedResults[cellId];
    if (result === undefined) fail();
    expectedDuration += result.durationMs;
  }
  const expectedTokens: TokenUsage = {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens,
  };
  if (
    completedIds.size !== checkpoint.completedCellIds.length ||
    failedIds.size !== checkpoint.failedCellIds.length ||
    !isDeepStrictEqual(checkpoint.totalTokens, expectedTokens) ||
    checkpoint.totalCostUSD !== expectedCost ||
    checkpoint.wallClockDurationMs !== expectedDuration
  )
    fail();
}

function isCanonicalSkippedResult(result: MatrixCellResult): boolean {
  return (
    result.status === "skipped" &&
    result.attemptCount === 0 &&
    result.startedAt === undefined &&
    result.completedAt === undefined &&
    result.durationMs === 0 &&
    !result.executionCompleted &&
    result.benchmarkCohort === "operational" &&
    result.eligibilityStatus === "ineligible" &&
    result.evaluationStatus === "not_requested" &&
    result.passedBenchmark === undefined &&
    result.scenarioResult === undefined &&
    result.runRecord === undefined &&
    result.error === undefined &&
    !result.retryable
  );
}

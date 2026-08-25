import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { createRunArtifactLayout } from "../infrastructure/workspace/run-artifact-layout.js";
import type { TelemetryDatabase } from "../reporting/db.js";
import type { RunRecord } from "../reporting/types.js";
import type { ScenarioResult } from "../runner/types.js";
import type { CheckpointState, MatrixCellDescriptor, MatrixCellResult } from "./types.js";
import { countToolErrors, isRunEvidenceTemporaryName, removeStaleRunEvidenceTemporaryFiles } from "./run-evidence.js";
import type { MatrixSweepConfig } from "./types.js";
import { sameMatrixCellDescriptor, validateCheckpointStateContract } from "./checkpoint-reconciliation.js";

export const terminalEvidenceConflictMessage = "Sweep terminal evidence is incompatible with the checkpoint";

export function validateCheckpointTerminalEvidence(
  cells: readonly MatrixCellDescriptor[],
  checkpoint: CheckpointState,
  telemetryDb: TelemetryDatabase | undefined,
  config: MatrixSweepConfig
): void {
  const cellsById = new Map(cells.map((cell) => [cell.cellId, cell]));
  const { completedIds, terminalIds } = validateCheckpointStateContract(cells, checkpoint, config, failReconciliation);
  for (const terminalId of terminalIds) {
    const cell = cellsById.get(terminalId);
    const checkpointResult = checkpoint.completedResults[terminalId];
    if (cell === undefined || checkpointResult === undefined || telemetryDb === undefined) failReconciliation();
    validateTerminalCell(cell, checkpointResult, telemetryDb, completedIds.has(terminalId), checkpoint.metadata.planFingerprint);
  }
  for (const cell of cells) {
    const layout = createRunArtifactLayout(cell.outputRoot, cell.runId);
    if (terminalIds.has(cell.cellId)) continue;
    if (telemetryDb?.getRunRecord(cell.runId) !== undefined || containsNonTemporaryArtifact(layout.runDirectory)) failReconciliation();
  }
}

export function cleanupValidatedTerminalEvidence(cells: readonly MatrixCellDescriptor[]): void {
  for (const cell of cells) removeStaleRunEvidenceTemporaryFiles(createRunArtifactLayout(cell.outputRoot, cell.runId));
}

export function validateSweepOutcomeEvidence(
  outcomePath: string,
  cells: readonly MatrixCellDescriptor[],
  checkpoint: CheckpointState,
  telemetryDb: TelemetryDatabase | undefined,
  planFingerprint: string,
  required: boolean
): void {
  if (!existsSync(outcomePath)) {
    if (required) failReconciliation();
    return;
  }
  const outcome = readRegularJson(outcomePath);
  const terminalCells = outcome.terminalCells;
  if (
    outcome.schemaVersion !== "1.0.0"
    || outcome.artifactKind !== "sweep-outcome"
    || outcome.sweepId !== cells[0]?.sweepId
    || outcome.planFingerprint !== planFingerprint
    || checkpoint.metadata.sweepId !== outcome.sweepId
    || checkpoint.metadata.planFingerprint !== outcome.planFingerprint
    || checkpoint.metadata.sweepStartedAt !== outcome.startedAt
    || checkpoint.metadata.updatedAt !== outcome.completedAt
    || checkpoint.status !== outcome.status
    || outcome.totalPlannedCells !== cells.length
    || !Array.isArray(terminalCells)
    || terminalCells.length !== cells.length
  ) failReconciliation();
  let completedCount = 0;
  let failedCount = 0;
  let abortedCount = 0;
  let skippedCount = 0;
  const sweepStartedMs = parseCanonicalTimestamp(outcome.startedAt);
  const sweepCompletedMs = parseCanonicalTimestamp(outcome.completedAt);
  const checkpointCreatedMs = parseCanonicalTimestamp(checkpoint.metadata.createdAt);
  const checkpointUpdatedMs = parseCanonicalTimestamp(checkpoint.metadata.updatedAt);
  if (
    sweepStartedMs > sweepCompletedMs
    || sweepStartedMs > checkpointCreatedMs
    || checkpointCreatedMs > checkpointUpdatedMs
    || checkpointUpdatedMs > sweepCompletedMs
  ) failReconciliation();
  const entriesByCell = new Map<string, Readonly<Record<string, unknown>>>();
  for (const value of terminalCells) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) failReconciliation();
    const entry = value as Readonly<Record<string, unknown>>;
    if (typeof entry.cellId !== "string" || entriesByCell.has(entry.cellId)) failReconciliation();
    entriesByCell.set(entry.cellId, entry);
    if (entry.status === "completed") completedCount += 1;
    else if (entry.status === "aborted") abortedCount += 1;
    else if (entry.status === "skipped") skippedCount += 1;
    else failedCount += 1;
  }
  for (const cell of cells) {
    const entry = entriesByCell.get(cell.cellId);
    const database = telemetryDb?.getRunRecord(cell.runId);
    const checkpointResult = checkpoint.completedResults[cell.cellId];
    const expectedPublicStatus = checkpointResult?.status
      ?? (checkpoint.skippedCellIds.includes(cell.cellId) ? "skipped" : undefined);
    if (
      entry === undefined
      || entry.matrixOccurrenceIndex !== cell.matrixOccurrenceIndex
      || entry.runId !== cell.runId
      || entry.scenarioId !== cell.scenarioId
      || entry.skillId !== cell.skillId
      || entry.modelId !== cell.modelId
      || entry.providerId !== cell.providerId
      || entry.executionMode !== cell.executionMode
      || entry.simulated !== (cell.executionMode === "fake")
      || (database !== undefined && entry.status !== database.status)
      || (database !== undefined && entry.terminationReason !== database.terminationReason)
      || entry.evidenceDurable !== (database !== undefined)
      || entry.publicStatus !== expectedPublicStatus
      || (database !== undefined && parseCanonicalTimestamp(database.startedAt) < sweepStartedMs)
      || (database !== undefined && parseCanonicalTimestamp(database.completedAt) > sweepCompletedMs)
    ) failReconciliation();
  }
  if (
    outcome.completedCount !== completedCount
    || outcome.failedCount !== failedCount
    || outcome.abortedCount !== abortedCount
    || outcome.skippedCount !== skippedCount
    || completedCount + failedCount + abortedCount + skippedCount !== cells.length
    || outcome.status !== "completed"
    || outcome.terminationReason !== "success"
    || outcome.orchestrationFailure !== undefined
  ) failReconciliation();
}

function parseCanonicalTimestamp(value: unknown): number {
  if (typeof value !== "string") failReconciliation();
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) failReconciliation();
  return timestamp;
}

function validateTerminalCell(
  cell: MatrixCellDescriptor,
  checkpointResult: MatrixCellResult,
  telemetryDb: TelemetryDatabase,
  expectedCompleted: boolean,
  planFingerprint: string
): void {
  const layout = createRunArtifactLayout(cell.outputRoot, cell.runId);
  const manifest = readRegularJson(layout.manifestPath);
  const databaseRecord = telemetryDb.getRunRecord(cell.runId);
  const scenarioResult = checkpointResult.scenarioResult;
  const checkpointRecord = checkpointResult.runRecord;
  if (databaseRecord === undefined || checkpointRecord === undefined) failReconciliation();
  assertDatabaseIdentity(databaseRecord, cell, planFingerprint);
  const result = readTerminalResult(layout.resultPath, layout.terminalFailurePath, expectedCompleted);
  assertCellResult(checkpointResult, cell, scenarioResult, databaseRecord, expectedCompleted);
  assertArtifactIdentity(manifest, cell, databaseRecord, "manifest");
  assertArtifactIdentity(result, cell, databaseRecord, expectedCompleted ? "result" : result.artifactKind);
  if (scenarioResult !== undefined) assertScenarioResult(scenarioResult, cell, result, databaseRecord);
  else assertMissingScenarioMetrics(result, databaseRecord);
  assertTerminalFields(manifest, result, databaseRecord, checkpointResult);
  if (!isDeepStrictEqual(checkpointRecord, databaseRecord)) failReconciliation();
}

function assertCellResult(
  checkpointResult: MatrixCellResult,
  cell: MatrixCellDescriptor,
  scenarioResult: ScenarioResult | undefined,
  databaseRecord: RunRecord,
  expectedCompleted: boolean
): void {
  if (
    checkpointResult.status !== (expectedCompleted ? "completed" : "failed")
    || checkpointResult.executionCompleted !== expectedCompleted
    || checkpointResult.retryable
    || (expectedCompleted ? checkpointResult.error !== undefined : typeof checkpointResult.error !== "string")
    || checkpointResult.passedBenchmark !== databaseRecord.passedBenchmark
    || checkpointResult.attemptCount !== databaseRecord.attemptCount
    || checkpointResult.startedAt !== databaseRecord.startedAt
    || checkpointResult.completedAt !== databaseRecord.completedAt
    || checkpointResult.durationMs !== databaseRecord.wallClockMs
    || checkpointResult.durationMs !== (scenarioResult?.totalDurationMs ?? databaseRecord.wallClockMs)
    || !sameMatrixCellDescriptor(checkpointResult.cell, cell)
    || (databaseRecord.status === "completed") !== expectedCompleted
  ) failReconciliation();
}

function assertScenarioResult(
  scenario: ScenarioResult,
  cell: MatrixCellDescriptor,
  result: Readonly<Record<string, unknown>>,
  database: RunRecord
): void {
  const toolErrorCount = countToolErrors(scenario);
  if (
    scenario.runId !== cell.runId
    || scenario.scenarioId !== cell.scenarioId
    || !isDeepStrictEqual(scenario.skillIds, [cell.skillId])
    || scenario.modelId !== cell.modelId
    || scenario.executionMode !== cell.executionMode
    || scenario.simulated !== (cell.executionMode === "fake")
    || scenario.terminationReason !== database.terminationReason
    || scenario.completed !== (database.status === "completed")
    || scenario.startedAt !== result.scenarioStartedAt
    || scenario.finishedAt !== database.completedAt
    || scenario.finishedAt !== result.scenarioCompletedAt
    || scenario.totalDurationMs !== result.totalDurationMs
    || scenario.totalDurationMs !== database.wallClockMs
    || scenario.totalTokens.totalTokens !== result.totalTokens
    || scenario.totalTokens.totalTokens !== database.totalTokens
    || !isDeepStrictEqual(scenario.totalTokens, result.usageBreakdown)
    || database.cacheHitRatio !== (scenario.totalTokens.totalTokens > 0 ? scenario.totalTokens.cacheReadInputTokens / scenario.totalTokens.totalTokens : 0)
    || scenario.totalCostUSD !== result.totalCostUSD
    || scenario.totalCostUSD !== database.totalCostUSD
    || scenario.turns !== result.totalTurns
    || scenario.turns !== database.totalTurns
    || toolErrorCount !== result.toolErrorCount
    || toolErrorCount !== database.errorCount
  ) failReconciliation();
}

function assertDatabaseIdentity(database: RunRecord, cell: MatrixCellDescriptor, planFingerprint: string): void {
  if (
    database.sweepId !== cell.sweepId
    || database.planFingerprint !== planFingerprint
    || database.cellId !== cell.cellId
    || database.matrixOccurrenceIndex !== cell.matrixOccurrenceIndex
    || database.runId !== cell.runId
    || database.scenarioId !== cell.scenarioId
    || database.skillId !== cell.skillId
    || database.modelId !== cell.modelId
    || database.providerId !== cell.providerId
    || database.executionMode !== cell.executionMode
    || database.simulated !== (cell.executionMode === "fake")
  ) failReconciliation();
}

function assertTerminalFields(
  manifest: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  database: RunRecord,
  checkpointResult: MatrixCellResult
): void {
  if (
    manifest.timestamp !== database.startedAt
    || manifest.startedAt !== database.startedAt
    || result.timestamp !== database.completedAt
    || result.startedAt !== database.startedAt
    || result.completedAt !== database.completedAt
    || result.status !== database.status
    || result.terminationReason !== database.terminationReason
    || result.attemptCount !== database.attemptCount
    || result.passedBenchmark !== database.passedBenchmark
    || checkpointResult.runRecord?.status !== result.status
    || checkpointResult.runRecord?.terminationReason !== result.terminationReason
  ) failReconciliation();
}

function assertArtifactIdentity(
  record: Readonly<Record<string, unknown>>,
  cell: MatrixCellDescriptor,
  database: RunRecord,
  artifactKind: unknown
): void {
  if (
    record.schemaVersion !== "1.0.0"
    || record.artifactKind !== artifactKind
    || record.sweepId !== cell.sweepId
    || record.planFingerprint !== database.planFingerprint
    || record.cellId !== cell.cellId
    || record.matrixOccurrenceIndex !== cell.matrixOccurrenceIndex
    || record.runId !== cell.runId
    || record.scenarioId !== cell.scenarioId
    || record.category !== database.category
    || record.skillId !== cell.skillId
    || record.modelId !== cell.modelId
    || record.providerId !== cell.providerId
    || record.executionMode !== cell.executionMode
    || record.simulated !== (cell.executionMode === "fake")
  ) failReconciliation();
}

function assertMissingScenarioMetrics(result: Readonly<Record<string, unknown>>, database: RunRecord): void {
  const tokenUsage = typeof result.usageBreakdown === "object" && result.usageBreakdown !== null
    ? result.usageBreakdown as Readonly<Record<string, unknown>>
    : undefined;
  if (
    result.totalDurationMs !== database.wallClockMs
    || result.totalTokens !== database.totalTokens
    || tokenUsage?.totalTokens !== database.totalTokens
    || result.totalCostUSD !== database.totalCostUSD
    || result.totalTurns !== database.totalTurns
    || result.toolErrorCount !== database.errorCount
  ) failReconciliation();
}

function readTerminalResult(
  resultPath: string,
  failurePath: string,
  expectedCompleted: boolean
): Readonly<Record<string, unknown>> {
  const hasResult = existsSync(resultPath);
  const hasFailure = existsSync(failurePath);
  if (hasResult === hasFailure) failReconciliation();
  if (expectedCompleted && !hasResult) failReconciliation();
  const value = readRegularJson(hasResult ? resultPath : failurePath);
  if (value.artifactKind !== (hasResult ? "result" : "terminal-failure")) failReconciliation();
  return value;
}

function readRegularJson(path: string): Readonly<Record<string, unknown>> {
  if (!existsSync(path)) failReconciliation();
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) failReconciliation();
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) failReconciliation();
    return value as Readonly<Record<string, unknown>>;
  } catch {
    failReconciliation();
  }
}

function containsNonTemporaryArtifact(runDirectory: string): boolean {
  if (!existsSync(runDirectory)) return false;
  const stats = lstatSync(runDirectory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) failReconciliation();
  for (const entry of readdirSync(runDirectory)) {
    if (!isRunEvidenceTemporaryName(entry)) return true;
    const temporaryStats = lstatSync(`${runDirectory}/${entry}`);
    if (!temporaryStats.isFile() || temporaryStats.isSymbolicLink()) failReconciliation();
  }
  return false;
}

function failReconciliation(): never {
  throw new TypeError(terminalEvidenceConflictMessage);
}

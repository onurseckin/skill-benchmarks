import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { createRunArtifactLayout } from "../infrastructure/workspace/run-artifact-layout.js";
import type { TelemetryDatabase } from "../reporting/db.js";
import type { RunRecord } from "../reporting/types.js";
import type { CheckpointState, MatrixCellDescriptor } from "./types.js";
import { removeStaleRunEvidenceTemporaryFiles } from "./run-evidence.js";

export const terminalEvidenceConflictMessage = "Sweep terminal evidence is incompatible with the checkpoint";

export function reconcileCheckpointTerminalEvidence(
  cells: readonly MatrixCellDescriptor[],
  checkpoint: CheckpointState,
  telemetryDb: TelemetryDatabase
): void {
  const cellsById = new Map(cells.map((cell) => [cell.cellId, cell]));
  const completedIds = new Set(checkpoint.completedCellIds);
  if (checkpoint.skippedCellIds.some((cellId) => !completedIds.has(cellId))) failReconciliation();
  for (const completedId of completedIds) {
    const cell = cellsById.get(completedId);
    const checkpointResult = checkpoint.completedResults[completedId];
    if (cell === undefined || checkpointResult === undefined || !checkpointResult.executionCompleted) failReconciliation();
    reconcileCompletedCell(cell, checkpointResult.cell.runId, telemetryDb);
  }
  for (const cell of cells) {
    const layout = createRunArtifactLayout(cell.outputRoot, cell.runId);
    removeStaleRunEvidenceTemporaryFiles(layout);
    if (completedIds.has(cell.cellId)) continue;
    if (telemetryDb.getRunRecord(cell.runId) !== undefined || containsTerminalArtifact(layout.runDirectory)) failReconciliation();
  }
}

function reconcileCompletedCell(cell: MatrixCellDescriptor, checkpointRunId: string, telemetryDb: TelemetryDatabase): void {
  if (checkpointRunId !== cell.runId) failReconciliation();
  const layout = createRunArtifactLayout(cell.outputRoot, cell.runId);
  removeStaleRunEvidenceTemporaryFiles(layout);
  const manifest = readRegularJson(layout.manifestPath);
  const result = readRegularJson(layout.resultPath);
  const databaseRecord = telemetryDb.getRunRecord(cell.runId);
  if (databaseRecord === undefined) failReconciliation();
  assertArtifactIdentity(manifest, cell);
  assertArtifactIdentity(result, cell);
  assertDatabaseIdentity(databaseRecord, cell);
  if (result.status !== "completed" || result.terminationReason !== "success") failReconciliation();
  if (databaseRecord.status !== "completed" || databaseRecord.terminationReason !== "success") failReconciliation();
  if (manifest.startedAt !== result.startedAt || result.startedAt !== databaseRecord.startedAt) failReconciliation();
  if (result.completedAt !== databaseRecord.completedAt) failReconciliation();
}

function assertArtifactIdentity(record: Readonly<Record<string, unknown>>, cell: MatrixCellDescriptor): void {
  if (
    record.runId !== cell.runId
    || record.scenarioId !== cell.scenarioId
    || record.skillId !== cell.skillId
    || record.modelId !== cell.modelId
    || record.providerId !== cell.providerId
    || record.executionMode !== cell.executionMode
    || record.simulated !== (cell.executionMode === "fake")
  ) failReconciliation();
}

function assertDatabaseIdentity(record: RunRecord, cell: MatrixCellDescriptor): void {
  if (
    record.runId !== cell.runId
    || record.scenarioId !== cell.scenarioId
    || record.skillId !== cell.skillId
    || record.modelId !== cell.modelId
    || record.providerId !== cell.providerId
    || record.executionMode !== cell.executionMode
    || record.simulated !== (cell.executionMode === "fake")
  ) failReconciliation();
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

function containsTerminalArtifact(runDirectory: string): boolean {
  if (!existsSync(runDirectory)) return false;
  const stats = lstatSync(runDirectory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) failReconciliation();
  return readdirSync(runDirectory).length > 0;
}

function failReconciliation(): never {
  throw new TypeError(terminalEvidenceConflictMessage);
}

import {
  createRunArtifactLayout,
  prepareRunArtifactLayout,
} from "../infrastructure/workspace/run-artifact-layout.js";
import { TelemetryDatabase, TerminalRunIdentityConflictError } from "../reporting/db.js";
import { createSafeArtifactPathSegment } from "../shared/artifact-sanitization.js";
import { writeRunManifest } from "./run-evidence.js";
import {
  createTerminalIdentityConflict,
  persistTerminalCell,
  persistTerminalFailure,
} from "./terminal-cell-persistence.js";
import type { MatrixCellDescriptor, MatrixCellResult, MatrixSweepConfig } from "./types.js";

export interface AbortedCellTerminalizationInput {
  readonly cell: MatrixCellDescriptor;
  readonly config: MatrixSweepConfig;
  readonly telemetryDb: TelemetryDatabase;
  readonly planFingerprint: string;
}

export async function terminalizeAbortedSweepCell(
  input: AbortedCellTerminalizationInput,
): Promise<MatrixCellResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const executionMode = input.config.dryRun ? "fake" : input.cell.executionMode;
  const context = {
    sweepId: input.cell.sweepId,
    planFingerprint: input.planFingerprint,
    cellId: input.cell.cellId,
    matrixOccurrenceIndex: input.cell.matrixOccurrenceIndex,
    runId: input.cell.runId,
    scenarioId: input.cell.scenarioId,
    category: "unknown",
    skillId: input.cell.skillId,
    modelId: input.cell.modelId,
    providerId: input.cell.providerId,
    executionMode,
    simulated: executionMode === "fake",
    dryRun: input.config.dryRun === true,
    startedAt,
  } as const;
  let artifactLayout = createAbortedCellArtifactLayout(input.cell);
  try {
    input.telemetryDb.claimRunIdentity(
      input.cell.runId,
      input.cell.sweepId,
      input.cell.cellId,
    );
  } catch (error) {
    if (!(error instanceof TerminalRunIdentityConflictError)) throw error;
    return createTerminalIdentityConflict(input.cell, startedAt, startedMs);
  }
  try {
    artifactLayout = await prepareRunArtifactLayout(artifactLayout);
    await writeRunManifest(artifactLayout, context);
  } catch {
    return persistTerminalFailure(
      input.cell,
      input.telemetryDb,
      artifactLayout,
      context,
      undefined,
      0,
      startedMs,
    );
  }
  return persistTerminalCell({
    cell: input.cell,
    telemetryDb: input.telemetryDb,
    artifactLayout,
    context,
    attemptCount: 0,
    terminationReason: "aborted",
    startedMs,
  });
}

function createAbortedCellArtifactLayout(cell: MatrixCellDescriptor) {
  try {
    return createRunArtifactLayout(cell.outputRoot, cell.runId);
  } catch {
    const fallbackRunId = createSafeArtifactPathSegment(
      `${cell.cellId}-${cell.runId}`,
      "failed-run",
    );
    return createRunArtifactLayout(cell.outputRoot, fallbackRunId);
  }
}

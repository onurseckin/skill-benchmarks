import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { RunRecord } from "../reporting/types.js";
import { sanitizeBenchmarkArtifactValue } from "../shared/artifact-sanitization.js";
import type { MatrixCellDescriptor, MatrixCellResult, SweepExecutionStatus } from "./types.js";

export interface SweepOutcomeInput {
  readonly outputRoot: string;
  readonly sweepId: string;
  readonly planFingerprint: string;
  readonly status: SweepExecutionStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly cells: readonly MatrixCellDescriptor[];
  readonly results: readonly MatrixCellResult[];
  readonly durableRecords: ReadonlyMap<string, RunRecord>;
  readonly orchestrationFailure?:
    | "checkpoint_persistence_failed"
    | "terminal_identity_conflict"
    | "database_preflight_failed";
}

export function createSweepOutcomePath(outputRoot: string, sweepId: string): string {
  return join(outputRoot, "sweeps", sweepId, "outcome.json");
}

export function writeDatabasePreflightFailureOutcome(
  outputRoot: string,
  sweepId: string,
  planFingerprint: string,
  startedAt: string,
  cells: readonly MatrixCellDescriptor[],
): void {
  writeSweepOutcome({
    outputRoot,
    sweepId,
    planFingerprint,
    status: "failed",
    startedAt,
    completedAt: new Date().toISOString(),
    cells,
    results: [],
    durableRecords: new Map(),
    orchestrationFailure: "database_preflight_failed",
  });
}

export function writeSweepOutcome(input: SweepOutcomeInput): void {
  const resultsByCell = new Map(input.results.map((result) => [result.cell.cellId, result]));
  const terminalCells = input.cells.map((cell) => {
    const result = resultsByCell.get(cell.cellId);
    const record = input.durableRecords.get(cell.cellId) ?? result?.runRecord;
    return {
      cellId: cell.cellId,
      matrixOccurrenceIndex: cell.matrixOccurrenceIndex,
      runId: cell.runId,
      scenarioId: cell.scenarioId,
      skillId: cell.skillId,
      modelId: cell.modelId,
      providerId: cell.providerId,
      executionMode: cell.executionMode,
      simulated: cell.executionMode === "fake",
      status: record?.status ?? (result?.status === "skipped" ? "skipped" : "unstarted"),
      terminationReason: record?.terminationReason ?? result?.error ?? "unstarted",
      benchmarkCohort: record?.benchmarkCohort ?? result?.benchmarkCohort ?? "operational",
      eligibilityStatus: record?.eligibility.status ?? result?.eligibilityStatus ?? "ineligible",
      evaluationStatus: record?.evaluation.status ?? result?.evaluationStatus ?? "not_requested",
      evidenceDurable: record !== undefined,
      publicStatus: result?.status ?? "pending",
    };
  });
  const completedCount = terminalCells.filter((cell) => cell.status === "completed").length;
  const abortedCount = terminalCells.filter((cell) => cell.status === "aborted").length;
  const skippedCount = terminalCells.filter((cell) => cell.status === "skipped").length;
  const failedCount = terminalCells.length - completedCount - abortedCount - skippedCount;
  const terminationReason =
    input.orchestrationFailure ??
    (input.status === "completed"
      ? "success"
      : input.status === "aborted"
        ? "aborted"
        : "cell_failure");
  const affectedCells =
    input.orchestrationFailure === "database_preflight_failed"
      ? terminalCells
      : terminalCells.filter((cell) => cell.publicStatus === "failed");
  commitImmutableJson(createSweepOutcomePath(input.outputRoot, input.sweepId), {
    schemaVersion: "1.0.0",
    artifactKind: "sweep-outcome",
    sweepId: input.sweepId,
    planFingerprint: input.planFingerprint,
    status: input.status,
    terminationReason,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    totalPlannedCells: input.cells.length,
    terminalCells,
    completedCount,
    failedCount,
    abortedCount,
    skippedCount,
    ...(input.orchestrationFailure === undefined
      ? {}
      : {
          orchestrationFailure: {
            reason: input.orchestrationFailure,
            affectedCellIds: affectedCells.map((cell) => cell.cellId),
            affectedRunIds: affectedCells.map((cell) => cell.runId),
          },
        }),
  });
}

function commitImmutableJson(path: string, value: unknown): void {
  const temporaryPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    const descriptor = openSync(temporaryPath, "wx", 0o600);
    try {
      writeFileSync(
        descriptor,
        JSON.stringify(sanitizeBenchmarkArtifactValue(value), null, 2),
        "utf8",
      );
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    linkSync(temporaryPath, path);
    const directoryDescriptor = openSync(dirname(path), "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
      const directoryDescriptor = openSync(dirname(path), "r");
      try {
        fsyncSync(directoryDescriptor);
      } finally {
        closeSync(directoryDescriptor);
      }
    }
  }
}

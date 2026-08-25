import { createRunArtifactLayout } from "../infrastructure/workspace/run-artifact-layout.js";
import { TelemetryDatabase, TerminalRunIdentityConflictError } from "../reporting/db.js";
import type { ScenarioResult, RunTerminationReason } from "../runner/types.js";
import { isEligibleRunRecord } from "../shared/benchmark-authority.js";
import type { MatrixCellDescriptor, MatrixCellResult } from "./types.js";
import {
  EvidenceCommitError,
  commitRunResult,
  commitTerminalFailure,
  createTerminalRunRecord,
  discardCommittedRunResult,
  mapTerminalStatus,
  summarizeTerminalFailure,
  type RunEvidenceContext,
} from "./run-evidence.js";

export interface PersistTerminalCellInput {
  readonly cell: MatrixCellDescriptor;
  readonly telemetryDb: TelemetryDatabase;
  readonly artifactLayout: ReturnType<typeof createRunArtifactLayout>;
  readonly context: RunEvidenceContext;
  readonly scenarioResult?: ScenarioResult;
  readonly attemptCount: number;
  readonly terminationReason: RunTerminationReason;
  readonly startedMs: number;
}

export function createTerminalIdentityConflict(
  cell: MatrixCellDescriptor,
  startedAt: string,
  startedMs: number
): MatrixCellResult {
  return {
    cell,
    status: "failed",
    attemptCount: 0,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    executionCompleted: false,
    benchmarkCohort: "operational",
    eligibilityStatus: "ineligible",
    evaluationStatus: "not_evaluated",
    error: "terminal run identity already exists",
    terminalIdentityConflict: true,
    retryable: false,
  };
}

export function persistTerminalCell(input: PersistTerminalCellInput): MatrixCellResult {
  const scenarioResult = normalizeScenarioResult(input.context, input.scenarioResult);
  const durationMs = scenarioResult?.totalDurationMs ?? Date.now() - input.startedMs;
  const terminal = {
    status: mapTerminalStatus(input.terminationReason),
    terminationReason: input.terminationReason,
    completedAt: scenarioResult?.finishedAt ?? new Date().toISOString(),
  } as const;
  const runRecord = createTerminalRunRecord(input.context, terminal, scenarioResult, input.attemptCount, durationMs);
  let resultIdentity: ReturnType<typeof commitRunResult> | undefined;
  try {
    input.telemetryDb.saveRunRecordWithArtifact(runRecord, () => {
      resultIdentity = commitRunResult(input.artifactLayout, input.context, terminal, scenarioResult, input.attemptCount, durationMs);
    });
  } catch (error) {
    if (error instanceof TerminalRunIdentityConflictError) {
      return createTerminalIdentityConflict(input.cell, input.context.startedAt, input.startedMs);
    }
    const committedIdentity = resultIdentity ?? (error instanceof EvidenceCommitError ? error.committedIdentity : undefined);
    const targetCommitted = committedIdentity !== undefined;
    if (targetCommitted) {
      try {
        discardCommittedRunResult(input.artifactLayout, committedIdentity);
      } catch {
        return createPersistenceFailureResult(input, scenarioResult, false);
      }
    }
    return createPersistenceFailureResult(input, scenarioResult, targetCommitted);
  }
  return createCellResult(input, scenarioResult, runRecord, terminal.terminationReason);
}

export function persistTerminalFailure(
  cell: MatrixCellDescriptor,
  telemetryDb: TelemetryDatabase,
  artifactLayout: ReturnType<typeof createRunArtifactLayout>,
  context: RunEvidenceContext,
  scenarioResult: ScenarioResult | undefined,
  attemptCount: number,
  startedMs: number
): MatrixCellResult {
  return createPersistenceFailureResult({
    cell,
    telemetryDb,
    artifactLayout,
    context,
    scenarioResult,
    attemptCount,
    terminationReason: "persistence_failed",
    startedMs,
  }, scenarioResult, true);
}

function createPersistenceFailureResult(
  input: PersistTerminalCellInput,
  scenarioResult: ScenarioResult | undefined,
  preferResultPath: boolean
): MatrixCellResult {
  const terminal = { status: "failed", terminationReason: "persistence_failed", completedAt: new Date().toISOString() } as const;
  const durationMs = scenarioResult?.totalDurationMs ?? Date.now() - input.startedMs;
  const runRecord = createTerminalRunRecord(input.context, terminal, scenarioResult, input.attemptCount, durationMs);
  let failureArtifactDurable = false;
  try {
    commitTerminalFailure(input.artifactLayout, input.context, terminal, scenarioResult, preferResultPath, input.attemptCount, durationMs);
    failureArtifactDurable = true;
  } catch {
    failureArtifactDurable = false;
  }
  let databaseRecordDurable = false;
  try {
    input.telemetryDb.saveRunRecord(runRecord);
    databaseRecordDurable = true;
  } catch {
    databaseRecordDurable = false;
  }
  const result = createCellResult(input, scenarioResult, runRecord, terminal.terminationReason);
  const { scenarioResult: executionResult, ...terminalResult } = result;
  const publicResult = executionResult === undefined ? result : terminalResult;
  return failureArtifactDurable && databaseRecordDurable ? publicResult : { ...publicResult, retryable: false };
}

function createCellResult(
  input: PersistTerminalCellInput,
  scenarioResult: ScenarioResult | undefined,
  runRecord: ReturnType<typeof createTerminalRunRecord>,
  terminationReason: RunTerminationReason
): MatrixCellResult {
  const executionCompleted = runRecord.status === "completed";
  return {
    cell: input.cell,
    status: executionCompleted ? "completed" : "failed",
    attemptCount: input.attemptCount,
    startedAt: input.context.startedAt,
    completedAt: runRecord.completedAt,
    durationMs: runRecord.wallClockMs,
    scenarioResult,
    runRecord,
    error: executionCompleted ? undefined : summarizeTerminalFailure(terminationReason),
    retryable: false,
    executionCompleted,
    benchmarkCohort: runRecord.benchmarkCohort,
    eligibilityStatus: runRecord.eligibility.status,
    evaluationStatus: runRecord.evaluation.status,
    ...(isEligibleRunRecord(runRecord) ? { passedBenchmark: runRecord.passedBenchmark } : {}),
  };
}

function normalizeScenarioResult(context: RunEvidenceContext, result: ScenarioResult | undefined): ScenarioResult | undefined {
  if (result === undefined) return undefined;
  return {
    ...result,
    executionMode: context.executionMode,
    simulated: context.simulated,
    totalCostUSD: context.executionMode === "fake" ? 0 : result.totalCostUSD,
  };
}

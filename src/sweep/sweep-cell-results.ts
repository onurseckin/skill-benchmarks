import type { MatrixCellDescriptor, MatrixCellResult } from "./types.js";

export function createCheckpointPersistenceFailure(result: MatrixCellResult): MatrixCellResult {
  const { runRecord, passedBenchmark, ...publicResult } = result;
  void passedBenchmark;
  return {
    ...publicResult,
    ...(runRecord === undefined || runRecord.status === "completed" ? {} : { runRecord }),
    status: "failed",
    executionCompleted: false,
    benchmarkCohort: "operational",
    eligibilityStatus: "ineligible",
    evaluationStatus: "not_evaluated",
    error: "checkpoint persistence failed",
    retryable: false,
  };
}

export function createSkippedSweepCellResult(cell: MatrixCellDescriptor): MatrixCellResult {
  return {
    cell,
    status: "skipped",
    attemptCount: 0,
    durationMs: 0,
    executionCompleted: false,
    benchmarkCohort: "operational",
    eligibilityStatus: "ineligible",
    evaluationStatus: "not_requested",
    retryable: false,
  };
}

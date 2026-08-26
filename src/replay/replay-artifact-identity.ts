import { ReplayEvidenceInvalidError } from "./errors.js";
import type { ReplayEvidenceIdentity, ReplayExecutionStatus } from "./types.js";

const terminalStatuses = new Set<ReplayExecutionStatus>([
  "completed",
  "failed",
  "timed_out",
  "aborted",
]);
const benchmarkCohorts = new Set(["eligible", "validation", "operational"]);
const eligibilityStatuses = new Set(["eligible", "ineligible", "unknown"]);
const evaluationStatuses = new Set(["not_requested", "not_evaluated", "evaluated", "invalid"]);

export function parseReplayArtifactIdentity(
  manifestContent: string,
  resultContent: string,
  expected: ReplayEvidenceIdentity = {},
): ReplayEvidenceIdentity {
  const manifest = parseRecord(manifestContent);
  const result = parseRecord(resultContent);
  validateManifest(manifest);
  validateResult(result);
  const commonKeys = [
    "runId",
    "sweepId",
    "cellId",
    "planFingerprint",
    "matrixOccurrenceIndex",
    "scenarioId",
    "category",
    "skillId",
    "modelId",
    "providerId",
    "executionMode",
    "simulated",
    "dryRun",
    "startedAt",
  ] as const;
  for (const key of commonKeys) requireEqual(manifest[key], result[key]);
  requireExpected(expected.runId, manifest.runId);
  requireExpected(expected.sweepId, manifest.sweepId);
  requireExpected(expected.cellId, manifest.cellId);
  requireExpected(expected.planFingerprint, manifest.planFingerprint);
  requireExpected(expected.matrixOccurrenceIndex, manifest.matrixOccurrenceIndex);
  requireExpected(expected.scenarioId, manifest.scenarioId);
  requireExpected(expected.category, manifest.category);
  requireExpected(expected.skillId, manifest.skillId);
  requireExpected(expected.modelId, manifest.modelId);
  requireExpected(expected.providerId, manifest.providerId);
  requireExpected(expected.executionMode, manifest.executionMode);
  requireExpected(expected.simulated, manifest.simulated);
  requireExpected(expected.dryRun, manifest.dryRun);
  requireExpected(expected.startedAt, manifest.startedAt);
  requireExpected(expected.completedAt, result.completedAt);
  requireExpected(expected.status, result.status);
  requireExpected(expected.terminationReason, result.terminationReason);
  requireExpected(expected.durationMs, result.totalDurationMs);
  requireExpected(expected.totalTurns, result.totalTurns);
  requireExpected(expected.totalTokens, result.totalTokens);
  requireExpected(expected.benchmarkCohort, result.benchmarkCohort);
  const eligibility = result.eligibility as Readonly<Record<string, unknown>>;
  const evaluation = result.evaluation as Readonly<Record<string, unknown>>;
  requireExpected(expected.eligibilityStatus, eligibility.status);
  requireExpectedReasons(expected.eligibilityReasons, eligibility.reasons);
  requireExpected(expected.evaluationStatus, evaluation.status);
  const totalCostUSD = readOperationalCost(result.operationalCost);
  requireExpected(expected.totalCostUSD, totalCostUSD);
  return {
    sourceKind: "canonical-run",
    runId: manifest.runId as string,
    sweepId: manifest.sweepId as string,
    cellId: manifest.cellId as string,
    planFingerprint: manifest.planFingerprint as string,
    matrixOccurrenceIndex: manifest.matrixOccurrenceIndex as number,
    scenarioId: manifest.scenarioId as string,
    category: manifest.category as string,
    skillId: manifest.skillId as string,
    modelId: manifest.modelId as string,
    providerId: manifest.providerId as string,
    executionMode: manifest.executionMode as "fake" | "live",
    simulated: manifest.simulated as boolean,
    dryRun: manifest.dryRun as boolean,
    startedAt: manifest.startedAt as string,
    completedAt: result.completedAt as string,
    status: result.status as ReplayExecutionStatus,
    terminationReason: result.terminationReason as string,
    durationMs: result.totalDurationMs as number,
    totalCostUSD,
    totalTurns: result.totalTurns as number,
    totalTokens: result.totalTokens as number,
    benchmarkCohort: result.benchmarkCohort as "eligible" | "validation" | "operational",
    eligibilityStatus: eligibility.status as "eligible" | "ineligible" | "unknown",
    eligibilityReasons: Object.freeze([...(eligibility.reasons as string[])]),
    evaluationStatus: evaluation.status as
      | "not_requested"
      | "not_evaluated"
      | "evaluated"
      | "invalid",
  };
}

function validateManifest(value: Readonly<Record<string, unknown>>): void {
  requireEqual(value.schemaVersion, "1.0.0");
  requireEqual(value.artifactKind, "manifest");
  requireIdentityFields(value);
  requireNonemptyString(value.category);
  requireNonnegativeInteger(value.matrixOccurrenceIndex);
  if (typeof value.dryRun !== "boolean") throw new ReplayEvidenceInvalidError();
  requireNonemptyString(value.startedAt);
  requireEqual(value.timestamp, value.startedAt);
}

function validateResult(value: Readonly<Record<string, unknown>>): void {
  requireEqual(value.schemaVersion, "2.0.0");
  requireEqual(value.artifactKind, "result");
  requireIdentityFields(value);
  requireNonemptyString(value.category);
  requireNonnegativeInteger(value.matrixOccurrenceIndex);
  if (typeof value.dryRun !== "boolean") throw new ReplayEvidenceInvalidError();
  requireNonemptyString(value.startedAt);
  requireNonemptyString(value.completedAt);
  const status = requireNonemptyString(value.status) as ReplayExecutionStatus;
  if (!terminalStatuses.has(status)) throw new ReplayEvidenceInvalidError();
  const reason = requireNonemptyString(value.terminationReason);
  if (mapExecutionStatus(reason) !== status) throw new ReplayEvidenceInvalidError();
  requireNonnegativeNumber(value.totalDurationMs);
  requireNonnegativeInteger(value.totalTurns);
  requireNonnegativeInteger(value.totalTokens);
  const cohort = requireNonemptyString(value.benchmarkCohort);
  if (!benchmarkCohorts.has(cohort)) throw new ReplayEvidenceInvalidError();
  const eligibility = requireRecord(value.eligibility);
  const eligibilityStatus = requireNonemptyString(eligibility.status);
  if (!eligibilityStatuses.has(eligibilityStatus) || !isStringArray(eligibility.reasons)) {
    throw new ReplayEvidenceInvalidError();
  }
  const evaluation = requireRecord(value.evaluation);
  const evaluationStatus = requireNonemptyString(evaluation.status);
  if (!evaluationStatuses.has(evaluationStatus)) throw new ReplayEvidenceInvalidError();
  readOperationalCost(value.operationalCost);
  requireEqual(value.timestamp, value.completedAt);
}

function requireIdentityFields(value: Readonly<Record<string, unknown>>): void {
  requireNonemptyString(value.runId);
  requireNonemptyString(value.sweepId);
  requireNonemptyString(value.cellId);
  requireNonemptyString(value.planFingerprint);
  requireNonemptyString(value.scenarioId);
  requireNonemptyString(value.skillId);
  requireNonemptyString(value.modelId);
  requireNonemptyString(value.providerId);
  if (value.executionMode !== "fake" && value.executionMode !== "live")
    throw new ReplayEvidenceInvalidError();
  if (typeof value.simulated !== "boolean") throw new ReplayEvidenceInvalidError();
}

function readOperationalCost(value: unknown): number {
  const cost = requireRecord(value);
  const amountUSD = requireNonnegativeNumber(cost.amountUSD);
  if (
    typeof cost.status !== "string" ||
    !new Set(["simulated_zero", "unverified", "verified"]).has(cost.status)
  ) {
    throw new ReplayEvidenceInvalidError();
  }
  return amountUSD;
}

function parseRecord(content: string): Readonly<Record<string, unknown>> {
  try {
    return requireRecord(JSON.parse(content) as unknown);
  } catch (error) {
    if (error instanceof ReplayEvidenceInvalidError) throw error;
    throw new ReplayEvidenceInvalidError();
  }
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new ReplayEvidenceInvalidError();
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireNonemptyString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new ReplayEvidenceInvalidError();
  return value;
}

function requireNonnegativeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new ReplayEvidenceInvalidError();
  return value;
}

function requireNonnegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new ReplayEvidenceInvalidError();
  return value;
}

function requireExpected(expected: unknown, actual: unknown): void {
  if (expected !== undefined && expected !== actual) throw new ReplayEvidenceInvalidError();
}

function requireExpectedReasons(expected: readonly string[] | undefined, actual: unknown): void {
  if (expected === undefined) return;
  if (
    !isStringArray(actual) ||
    expected.length !== actual.length ||
    expected.some((reason, index) => reason !== actual[index])
  ) {
    throw new ReplayEvidenceInvalidError();
  }
}

function requireEqual(left: unknown, right: unknown): void {
  if (left !== right) throw new ReplayEvidenceInvalidError();
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function mapExecutionStatus(reason: string): ReplayExecutionStatus {
  if (reason === "success") return "completed";
  if (reason === "timeout") return "timed_out";
  if (reason === "aborted") return "aborted";
  return "failed";
}

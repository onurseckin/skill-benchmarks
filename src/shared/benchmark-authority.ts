import type { ExecutionMode } from "./execution-mode.js";

export type BenchmarkCohort = "eligible" | "validation" | "operational";
export type BenchmarkEligibilityStatus = "eligible" | "ineligible" | "unknown";
export type EvaluationOutcomeStatus = "not_requested" | "not_evaluated" | "evaluated" | "invalid";
export type EvidenceStateStatus = "unavailable" | "collecting" | "complete" | "invalid";
export type ArtifactIntegrityStatus = "unverified" | "verified" | "invalid";

export type BenchmarkIneligibilityReason =
  | "fake_execution" | "simulated_execution" | "dry_run"
  | "execution_incomplete" | "execution_failed" | "execution_timed_out" | "execution_aborted"
  | "setup_failed" | "persistence_failed" | "cleanup_failed"
  | "evaluation_not_requested" | "evaluation_missing"
  | "no_required_checks" | "no_executed_checks" | "required_checks_incomplete"
  | "artifact_integrity_unverified" | "artifact_integrity_invalid"
  | "evaluator_identity_missing" | "evidence_digest_missing" | "evidence_identity_mismatch"
  | "score_invalid" | "pass_inconsistent"
  | "evidence_invalid";

export const benchmarkReasonOrder: readonly BenchmarkIneligibilityReason[] = [
  "fake_execution", "simulated_execution", "dry_run", "execution_incomplete",
  "execution_failed", "execution_timed_out", "execution_aborted", "setup_failed",
  "persistence_failed", "cleanup_failed", "evaluation_not_requested", "evaluation_missing",
  "no_required_checks", "no_executed_checks", "required_checks_incomplete",
  "artifact_integrity_unverified", "artifact_integrity_invalid", "evaluator_identity_missing",
  "evidence_digest_missing", "evidence_identity_mismatch", "score_invalid",
  "pass_inconsistent", "evidence_invalid",
] as const;

export interface BenchmarkEvidenceIdentity {
  readonly runId: string;
  readonly scenarioId: string;
  readonly skillId: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly workspaceFingerprint: string;
}

interface EvidenceStateBase {
  readonly requiredChecksDeclared: number;
  readonly requiredChecksExecuted: number;
  readonly requiredChecksPassed: number;
  readonly artifactIntegrity: ArtifactIntegrityStatus;
  readonly evaluatorId?: string;
  readonly evaluatorVersion?: string;
  readonly evidenceDigest?: string;
  readonly identity?: BenchmarkEvidenceIdentity;
}

export interface UnavailableEvidenceState extends EvidenceStateBase {
  readonly status: "unavailable";
}
export interface CollectingEvidenceState extends EvidenceStateBase {
  readonly status: "collecting";
}

export interface CompleteEvidenceState extends EvidenceStateBase {
  readonly status: "complete";
  readonly artifactIntegrity: "verified";
  readonly evaluatorId: string;
  readonly evaluatorVersion: string;
  readonly evidenceDigest: string;
  readonly identity: BenchmarkEvidenceIdentity;
}

export interface InvalidEvidenceState extends EvidenceStateBase {
  readonly status: "invalid";
}
export type EvidenceState =
  | UnavailableEvidenceState
  | CollectingEvidenceState
  | CompleteEvidenceState
  | InvalidEvidenceState;

export interface UnevaluatedOutcome {
  readonly status: "not_requested" | "not_evaluated" | "invalid";
  readonly reasons: readonly BenchmarkIneligibilityReason[];
}
export interface EvaluatedOutcome {
  readonly status: "evaluated";
  readonly compositeScore: number;
  readonly passed: boolean;
  readonly passScoreThreshold: number;
  readonly requireAllDeterministicPass: boolean;
  readonly evaluatedAt: string;
}

export type EvaluationOutcome = UnevaluatedOutcome | EvaluatedOutcome;

export interface SimulatedZeroCostEvidence {
  readonly status: "simulated_zero";
  readonly amountUSD: 0;
}
export interface UnverifiedCostEvidence {
  readonly status: "unverified";
  readonly amountUSD: number;
}

export interface VerifiedCostEvidence {
  readonly status: "verified";
  readonly amountUSD: number;
  readonly pricingIdentity: string;
  readonly usageDigest: string;
}

export type OperationalCostEvidence = SimulatedZeroCostEvidence | UnverifiedCostEvidence | VerifiedCostEvidence;

export interface BenchmarkEligibility {
  readonly status: BenchmarkEligibilityStatus;
  readonly reasons: readonly BenchmarkIneligibilityReason[];
}
export interface EligibleBenchmarkAuthority {
  readonly benchmarkCohort: "eligible";
  readonly eligibility: { readonly status: "eligible"; readonly reasons: readonly [] };
  readonly evidence: CompleteEvidenceState;
  readonly evaluation: EvaluatedOutcome;
  readonly operationalCost: OperationalCostEvidence;
  readonly compositeScore: number;
  readonly passedBenchmark: boolean;
  readonly actualCostUSD?: number;
}

export interface NonEligibleBenchmarkAuthority {
  readonly benchmarkCohort: "validation" | "operational";
  readonly eligibility: { readonly status: "ineligible" | "unknown"; readonly reasons: readonly BenchmarkIneligibilityReason[] };
  readonly evidence: EvidenceState;
  readonly evaluation: UnevaluatedOutcome;
  readonly operationalCost: SimulatedZeroCostEvidence | UnverifiedCostEvidence;
}
export type BenchmarkAuthority = EligibleBenchmarkAuthority | NonEligibleBenchmarkAuthority;

export interface BenchmarkAuthorityInput {
  readonly executionMode: ExecutionMode;
  readonly simulated: boolean;
  readonly dryRun: boolean;
  readonly lifecycleStatus: string;
  readonly terminationReason?: string;
  readonly expectedIdentity: BenchmarkEvidenceIdentity;
  readonly evidence: EvidenceState;
  readonly evaluation: EvaluationOutcome;
  readonly operationalCost: OperationalCostEvidence;
}

export function sortBenchmarkReasons(reasons: Iterable<BenchmarkIneligibilityReason>): readonly BenchmarkIneligibilityReason[] {
  const present = new Set(reasons);
  return benchmarkReasonOrder.filter((reason) => present.has(reason));
}

export function classifyBenchmarkAuthority(input: BenchmarkAuthorityInput): BenchmarkAuthority {
  const reasons = collectReasons(input);
  if (reasons.length === 0 && input.evidence.status === "complete" && input.evaluation.status === "evaluated") {
    const actualCostUSD = input.operationalCost.status === "verified" ? input.operationalCost.amountUSD : undefined;
    return {
      benchmarkCohort: "eligible",
      eligibility: { status: "eligible", reasons: [] },
      evidence: input.evidence,
      evaluation: input.evaluation,
      operationalCost: input.operationalCost,
      compositeScore: input.evaluation.compositeScore,
      passedBenchmark: input.evaluation.passed,
      ...(actualCostUSD === undefined ? {} : { actualCostUSD }),
    };
  }
  const benchmarkCohort = isValidationExecution(input) && isSuccessfulLifecycle(input)
    ? "validation"
    : "operational";
  const outcomeStatus = input.evaluation.status === "not_requested"
    ? "not_requested"
    : input.evaluation.status === "not_evaluated"
      ? "not_evaluated"
      : "invalid";
  return {
    benchmarkCohort,
    eligibility: { status: "ineligible", reasons },
    evidence: normalizeNonEligibleEvidence(input.evidence),
    evaluation: { status: outcomeStatus, reasons },
    operationalCost: normalizeNonEligibleCost(input),
  };
}

export function isEligibleBenchmarkAuthority(value: BenchmarkAuthority): value is EligibleBenchmarkAuthority {
  return value.eligibility.status === "eligible";
}

export function isEligibleRunRecord<T extends BenchmarkAuthority>(value: T): value is T & EligibleBenchmarkAuthority {
  return value.eligibility.status === "eligible";
}

export function assertBenchmarkAuthority(value: BenchmarkAuthority): void {
  if (value.eligibility.status === "eligible") {
    if (
      value.benchmarkCohort !== "eligible"
      || value.evidence.status !== "complete"
      || value.evaluation.status !== "evaluated"
      || value.compositeScore !== value.evaluation.compositeScore
      || value.passedBenchmark !== value.evaluation.passed
      || value.eligibility.reasons.length !== 0
      || !hasOnlyKeys(value.evaluation, ["status", "compositeScore", "passed", "passScoreThreshold", "requireAllDeterministicPass", "evaluatedAt"])
      || !hasOnlyKeys(value.eligibility, ["status", "reasons"])
      || !hasOnlyKeys(value.evidence, evidenceKeys)
      || !hasOnlyKeys(value.operationalCost, value.operationalCost.status === "verified" ? verifiedCostKeys : basicCostKeys)
      || !["simulated_zero", "unverified", "verified"].includes(value.operationalCost.status)
      || !validCompleteEvidence(value.evidence)
      || !finiteRange(value.evaluation.compositeScore, 0, 100)
      || !finiteRange(value.evaluation.passScoreThreshold, 0, 100)
      || typeof value.evaluation.passed !== "boolean" || typeof value.evaluation.requireAllDeterministicPass !== "boolean"
      || typeof value.evaluation.evaluatedAt !== "string" || value.evaluation.evaluatedAt.trim().length === 0
      || value.evaluation.passed !== expectedEvaluationPass(value.evaluation, value.evidence)
      || value.operationalCost.status === "simulated_zero"
      || !Number.isFinite(value.operationalCost.amountUSD)
      || value.operationalCost.amountUSD < 0
      || (value.actualCostUSD !== undefined && (!Number.isFinite(value.actualCostUSD) || value.actualCostUSD < 0))
      || (value.operationalCost.status === "verified" && value.actualCostUSD !== value.operationalCost.amountUSD)
      || (value.operationalCost.status !== "verified" && "actualCostUSD" in value)
    ) throw new TypeError("Benchmark authority is contradictory");
    return;
  }
  if (
    value.benchmarkCohort === "eligible"
    || !["validation", "operational"].includes(value.benchmarkCohort)
    || !["ineligible", "unknown"].includes(value.eligibility.status)
    || !["not_requested", "not_evaluated", "invalid"].includes(value.evaluation.status)
    || !["unavailable", "collecting", "complete", "invalid"].includes(value.evidence.status)
    || !["unverified", "verified", "invalid"].includes(value.evidence.artifactIntegrity)
    || !["simulated_zero", "unverified"].includes(value.operationalCost.status)
    || "compositeScore" in value
    || "passedBenchmark" in value
    || "actualCostUSD" in value
    || value.eligibility.reasons.length === 0
    || !hasOnlyKeys(value.evaluation, ["status", "reasons"])
    || !hasOnlyKeys(value.eligibility, ["status", "reasons"])
    || !hasOnlyKeys(value.evidence, evidenceKeys)
    || !hasOnlyKeys(value.operationalCost, basicCostKeys)
    || !sameReasons(value.evaluation.reasons, value.eligibility.reasons)
    || !validEvidenceCounts(value.evidence)
    || (value.evidence.status === "complete" && !validCompleteEvidence(value.evidence))
    || !Number.isFinite(value.operationalCost.amountUSD)
    || value.operationalCost.amountUSD < 0
    || (value.operationalCost.status === "simulated_zero" && value.operationalCost.amountUSD !== 0)
    || !sameReasons(value.eligibility.reasons, sortBenchmarkReasons(value.eligibility.reasons))
  ) throw new TypeError("Non-eligible benchmark evidence contains claims");
}

function collectReasons(input: BenchmarkAuthorityInput): readonly BenchmarkIneligibilityReason[] {
  const reasons = new Set<BenchmarkIneligibilityReason>();
  if (input.executionMode === "fake") reasons.add("fake_execution");
  if (input.simulated) reasons.add("simulated_execution");
  if (input.dryRun) reasons.add("dry_run");
  addLifecycleReason(input, reasons);
  addEvaluationReasons(input, reasons);
  if (!Number.isFinite(input.operationalCost.amountUSD) || input.operationalCost.amountUSD < 0) reasons.add("evidence_invalid");
  if (input.operationalCost.status === "simulated_zero" && input.operationalCost.amountUSD !== 0) reasons.add("evidence_invalid");
  if (!isValidationExecution(input) && input.operationalCost.status === "simulated_zero") reasons.add("evidence_invalid");
  if (input.operationalCost.status === "verified" && (!nonempty(input.operationalCost.pricingIdentity) || !nonempty(input.operationalCost.usageDigest))) reasons.add("evidence_invalid");
  if (!["unavailable", "collecting", "complete", "invalid"].includes(input.evidence.status) || !["not_requested", "not_evaluated", "evaluated", "invalid"].includes(input.evaluation.status) || !["unverified", "verified", "invalid"].includes(input.evidence.artifactIntegrity) || !["simulated_zero", "unverified", "verified"].includes(input.operationalCost.status) || !["fake", "live"].includes(input.executionMode) || typeof input.simulated !== "boolean" || typeof input.dryRun !== "boolean") reasons.add("evidence_invalid");
  return sortBenchmarkReasons(reasons);
}

function addLifecycleReason(input: BenchmarkAuthorityInput, reasons: Set<BenchmarkIneligibilityReason>): void {
  if (input.lifecycleStatus === "timed_out" || input.terminationReason === "timeout") reasons.add("execution_timed_out");
  else if (input.lifecycleStatus === "aborted" || input.terminationReason === "aborted") reasons.add("execution_aborted");
  else if (input.terminationReason === "setup_failed") reasons.add("setup_failed");
  else if (input.terminationReason === "persistence_failed") reasons.add("persistence_failed");
  else if (input.terminationReason === "cleanup_failed") reasons.add("cleanup_failed");
  else if (input.lifecycleStatus === "failed") reasons.add("execution_failed");
  else if (!isSuccessfulLifecycle(input)) reasons.add("execution_incomplete");
}

function addEvaluationReasons(input: BenchmarkAuthorityInput, reasons: Set<BenchmarkIneligibilityReason>): void {
  const evidence = input.evidence;
  if (input.evaluation.status === "not_requested") reasons.add("evaluation_not_requested");
  else if (input.evaluation.status === "not_evaluated") reasons.add("evaluation_missing");
  else if (input.evaluation.status === "invalid") reasons.add("evidence_invalid");
  if (!integerAtLeast(evidence.requiredChecksDeclared, 1)) reasons.add("no_required_checks");
  if (!integerAtLeast(evidence.requiredChecksExecuted, 1)) reasons.add("no_executed_checks");
  if (
    !Number.isInteger(evidence.requiredChecksPassed)
    || evidence.requiredChecksPassed < 0
    || evidence.requiredChecksExecuted > evidence.requiredChecksDeclared
    || evidence.requiredChecksPassed > evidence.requiredChecksExecuted
    || evidence.requiredChecksExecuted !== evidence.requiredChecksDeclared
  ) reasons.add("required_checks_incomplete");
  if (evidence.artifactIntegrity === "unverified") reasons.add("artifact_integrity_unverified");
  else if (evidence.artifactIntegrity === "invalid") reasons.add("artifact_integrity_invalid");
  if (!nonempty(evidence.evaluatorId) || !nonempty(evidence.evaluatorVersion)) reasons.add("evaluator_identity_missing");
  if (!nonempty(evidence.evidenceDigest)) reasons.add("evidence_digest_missing");
  if (evidence.status === "invalid") reasons.add("evidence_invalid");
  if (input.evaluation.status === "evaluated" && evidence.status !== "complete") reasons.add("evidence_invalid");
  if (evidence.status === "complete" && (!isEvidenceIdentity(evidence.identity) || !sameIdentity(evidence.identity, input.expectedIdentity))) reasons.add("evidence_identity_mismatch");
  if (input.evaluation.status === "evaluated") {
    const evaluation = input.evaluation;
    if (!finiteRange(evaluation.compositeScore, 0, 100) || !finiteRange(evaluation.passScoreThreshold, 0, 100)) reasons.add("score_invalid");
    if (typeof evaluation.passed !== "boolean" || typeof evaluation.requireAllDeterministicPass !== "boolean" || typeof evaluation.evaluatedAt !== "string" || evaluation.evaluatedAt.trim().length === 0) reasons.add("evidence_invalid");
    const expectedPass = evaluation.compositeScore >= evaluation.passScoreThreshold
      && (!evaluation.requireAllDeterministicPass || evidence.requiredChecksPassed === evidence.requiredChecksDeclared);
    if (evaluation.passed !== expectedPass) reasons.add("pass_inconsistent");
  }
}

function normalizeNonEligibleCost(input: BenchmarkAuthorityInput): SimulatedZeroCostEvidence | UnverifiedCostEvidence {
  if (isValidationExecution(input)) return { status: "simulated_zero", amountUSD: 0 };
  const amountUSD = Number.isFinite(input.operationalCost.amountUSD) && input.operationalCost.amountUSD >= 0
    ? input.operationalCost.amountUSD
    : 0;
  return { status: "unverified", amountUSD };
}
function normalizeNonEligibleEvidence(value: EvidenceState): EvidenceState {
  const validIntegrity = ["unverified", "verified", "invalid"].includes(value.artifactIntegrity);
  const validStatus = ["unavailable", "collecting", "invalid"].includes(value.status) || (value.status === "complete" && validCompleteEvidence(value));
  if (validEvidenceCounts(value) && validIntegrity && validStatus) return value;
  const declared = integerAtLeast(value.requiredChecksDeclared, 0) ? value.requiredChecksDeclared : 0;
  const executed = integerAtLeast(value.requiredChecksExecuted, 0)
    ? Math.min(value.requiredChecksExecuted, declared)
    : 0;
  const passed = integerAtLeast(value.requiredChecksPassed, 0)
    ? Math.min(value.requiredChecksPassed, executed)
    : 0;
  return {
    ...value,
    status: "invalid",
    artifactIntegrity: validIntegrity ? value.artifactIntegrity : "invalid",
    requiredChecksDeclared: declared,
    requiredChecksExecuted: executed,
    requiredChecksPassed: passed,
  };
}
function isValidationExecution(input: BenchmarkAuthorityInput): boolean {
  return input.executionMode === "fake" || input.simulated || input.dryRun;
}
function isSuccessfulLifecycle(input: BenchmarkAuthorityInput): boolean {
  return input.lifecycleStatus === "completed" && input.terminationReason === "success";
}
function integerAtLeast(value: number, minimum: number): boolean {
  return Number.isInteger(value) && value >= minimum;
}
function finiteRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}
function nonempty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function sameIdentity(left: BenchmarkEvidenceIdentity, right: BenchmarkEvidenceIdentity): boolean {
  return left.runId === right.runId
    && left.scenarioId === right.scenarioId
    && left.skillId === right.skillId
    && left.modelId === right.modelId
    && left.providerId === right.providerId
    && left.workspaceFingerprint === right.workspaceFingerprint;
}

function sameReasons(left: readonly BenchmarkIneligibilityReason[], right: readonly BenchmarkIneligibilityReason[]): boolean {
  return left.length === right.length && left.every((reason, index) => reason === right[index]);
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function validEvidenceCounts(value: EvidenceState): boolean {
  return Number.isInteger(value.requiredChecksDeclared)
    && Number.isInteger(value.requiredChecksExecuted)
    && Number.isInteger(value.requiredChecksPassed)
    && value.requiredChecksDeclared >= 0
    && value.requiredChecksExecuted >= 0
    && value.requiredChecksPassed >= 0
    && value.requiredChecksPassed <= value.requiredChecksExecuted
    && value.requiredChecksExecuted <= value.requiredChecksDeclared;
}

function validCompleteEvidence(value: CompleteEvidenceState): boolean {
  return validEvidenceCounts(value)
    && value.requiredChecksDeclared > 0
    && value.requiredChecksExecuted === value.requiredChecksDeclared
    && value.artifactIntegrity === "verified"
    && nonempty(value.evaluatorId)
    && nonempty(value.evaluatorVersion)
    && nonempty(value.evidenceDigest)
    && isEvidenceIdentity(value.identity);
}

function isEvidenceIdentity(value: BenchmarkEvidenceIdentity | undefined): value is BenchmarkEvidenceIdentity {
  return typeof value === "object" && value !== null && nonempty(value.runId) && nonempty(value.scenarioId)
    && nonempty(value.skillId) && nonempty(value.modelId) && nonempty(value.providerId)
    && nonempty(value.workspaceFingerprint);
}

function expectedEvaluationPass(evaluation: EvaluatedOutcome, evidence: CompleteEvidenceState): boolean {
  return evaluation.compositeScore >= evaluation.passScoreThreshold
    && (!evaluation.requireAllDeterministicPass || evidence.requiredChecksPassed === evidence.requiredChecksDeclared);
}

const evidenceKeys = [
  "status", "requiredChecksDeclared", "requiredChecksExecuted", "requiredChecksPassed",
  "artifactIntegrity", "evaluatorId", "evaluatorVersion", "evidenceDigest", "identity",
] as const;

const basicCostKeys = ["status", "amountUSD"] as const;
const verifiedCostKeys = ["status", "amountUSD", "pricingIdentity", "usageDigest"] as const;

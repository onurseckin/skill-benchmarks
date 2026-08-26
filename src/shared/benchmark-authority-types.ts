import type { ExecutionMode } from "./execution-mode.js";

export type BenchmarkCohort = "eligible" | "validation" | "operational";
export type BenchmarkEligibilityStatus = "eligible" | "ineligible" | "unknown";
export type EvaluationOutcomeStatus = "not_requested" | "not_evaluated" | "evaluated" | "invalid";
export type EvidenceStateStatus = "unavailable" | "collecting" | "complete" | "invalid";
export type ArtifactIntegrityStatus = "unverified" | "verified" | "invalid";

export type BenchmarkIneligibilityReason =
  | "fake_execution"
  | "simulated_execution"
  | "dry_run"
  | "execution_incomplete"
  | "execution_failed"
  | "execution_timed_out"
  | "execution_aborted"
  | "setup_failed"
  | "persistence_failed"
  | "cleanup_failed"
  | "evaluation_not_requested"
  | "evaluation_missing"
  | "no_required_checks"
  | "no_executed_checks"
  | "required_checks_incomplete"
  | "artifact_integrity_unverified"
  | "artifact_integrity_invalid"
  | "evaluator_identity_missing"
  | "evidence_digest_missing"
  | "evidence_identity_mismatch"
  | "score_invalid"
  | "pass_inconsistent"
  | "evidence_invalid";

export const benchmarkReasonOrder: readonly BenchmarkIneligibilityReason[] = [
  "fake_execution",
  "simulated_execution",
  "dry_run",
  "execution_incomplete",
  "execution_failed",
  "execution_timed_out",
  "execution_aborted",
  "setup_failed",
  "persistence_failed",
  "cleanup_failed",
  "evaluation_not_requested",
  "evaluation_missing",
  "no_required_checks",
  "no_executed_checks",
  "required_checks_incomplete",
  "artifact_integrity_unverified",
  "artifact_integrity_invalid",
  "evaluator_identity_missing",
  "evidence_digest_missing",
  "evidence_identity_mismatch",
  "score_invalid",
  "pass_inconsistent",
  "evidence_invalid",
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

export type OperationalCostEvidence =
  | SimulatedZeroCostEvidence
  | UnverifiedCostEvidence
  | VerifiedCostEvidence;

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
  readonly eligibility: {
    readonly status: "ineligible" | "unknown";
    readonly reasons: readonly BenchmarkIneligibilityReason[];
  };
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

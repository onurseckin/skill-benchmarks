import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  ArtifactIntegrityStatus,
  BenchmarkIneligibilityReason,
  BenchmarkEvidenceIdentity,
  EvidenceState,
  EvaluationOutcome,
} from "../shared/benchmark-authority.js";
import { validateEvaluatedDeterministicSummary } from "./scoring.js";
import type {
  CompositeEvaluationSummary,
  DeterministicSummary,
  EvaluatedCompositeSummary,
  EvaluatedDeterministicSummary,
} from "./types.js";

export interface EvaluationEvidenceInput {
  readonly expectedIdentity: BenchmarkEvidenceIdentity;
  readonly observedIdentity?: BenchmarkEvidenceIdentity;
  readonly evaluatorId?: string;
  readonly evaluatorVersion?: string;
  readonly workspaceFingerprint?: string;
  readonly evidenceDigest?: string;
  readonly artifactIntegrity: ArtifactIntegrityStatus;
  readonly deterministicSummary?: DeterministicSummary;
  readonly compositeSummary?: CompositeEvaluationSummary;
}

export interface EvaluationEvidenceContract {
  readonly evidence: EvidenceState;
  readonly evaluation: EvaluationOutcome;
}

export function createEvaluationEvidence(
  input: EvaluationEvidenceInput,
): EvaluationEvidenceContract {
  const deterministic = input.deterministicSummary;
  const composite = input.compositeSummary;
  const observedIdentity = validIdentity(input.observedIdentity)
    ? { ...input.observedIdentity }
    : undefined;
  const declared =
    deterministic?.status === "evaluated" && safeCount(deterministic.totalChecksCount)
      ? deterministic.totalChecksCount
      : 0;
  const executed =
    deterministic?.status === "evaluated" && Array.isArray(deterministic.checkResults)
      ? Math.min(deterministic.checkResults.length, declared)
      : 0;
  const passed =
    deterministic?.status === "evaluated" && safeCount(deterministic.passedChecksCount)
      ? Math.min(deterministic.passedChecksCount, executed)
      : 0;
  const baseEvidence = {
    requiredChecksDeclared: declared,
    requiredChecksExecuted: executed,
    requiredChecksPassed: passed,
    artifactIntegrity: input.artifactIntegrity,
    ...(nonempty(input.evaluatorId) ? { evaluatorId: input.evaluatorId } : {}),
    ...(nonempty(input.evaluatorVersion) ? { evaluatorVersion: input.evaluatorVersion } : {}),
    ...(nonempty(input.evidenceDigest) ? { evidenceDigest: input.evidenceDigest } : {}),
    ...(observedIdentity === undefined ? {} : { identity: observedIdentity }),
  };
  if (deterministic?.status === "invalid" || composite?.status === "invalid") {
    const reasons =
      composite?.status === "invalid"
        ? composite.reasons
        : deterministic?.status === "invalid"
          ? deterministic.reasons
          : (["evidence_invalid"] as const);
    return {
      evidence: { ...baseEvidence, status: "invalid" },
      evaluation: { status: "invalid", reasons },
    };
  }
  if (deterministic?.status !== "evaluated" || composite?.status !== "evaluated") {
    const reasons =
      composite?.status === "not_evaluated"
        ? composite.reasons
        : deterministic?.status === "not_evaluated"
          ? deterministic.reasons
          : (["evaluation_missing"] as const);
    return {
      evidence: { ...baseEvidence, status: "unavailable" },
      evaluation: { status: "not_evaluated", reasons },
    };
  }
  const bundleReason = validateEvidenceBundle(input, deterministic, composite);
  if (bundleReason !== undefined) return invalidContract(baseEvidence, bundleReason);
  const complete =
    input.artifactIntegrity === "verified" &&
    nonempty(input.evaluatorId) &&
    nonempty(input.evaluatorVersion) &&
    nonempty(input.evidenceDigest) &&
    validIdentity(input.observedIdentity) &&
    nonempty(input.workspaceFingerprint);
  if (!complete) {
    return {
      evidence: { ...baseEvidence, status: "collecting" },
      evaluation: { status: "not_evaluated", reasons: ["evaluation_missing"] },
    };
  }
  if (input.evidenceDigest !== createEvaluationEvidenceDigest(input)) {
    return invalidContract(baseEvidence, "evidence_invalid");
  }
  const evidence: EvidenceState = {
    ...baseEvidence,
    status: "complete",
    artifactIntegrity: "verified",
    evaluatorId: input.evaluatorId,
    evaluatorVersion: input.evaluatorVersion,
    evidenceDigest: input.evidenceDigest,
    identity: { ...input.observedIdentity },
  };
  return {
    evidence,
    evaluation: {
      status: "evaluated",
      compositeScore: composite.compositeScore,
      passed: composite.passed,
      passScoreThreshold: composite.passScoreThreshold,
      requireAllDeterministicPass: composite.requireAllDeterministicPass,
      evaluatedAt: composite.evaluatedAt,
    },
  };
}

export function createEvaluationEvidenceDigest(
  input: Omit<EvaluationEvidenceInput, "evidenceDigest">,
): string {
  if (
    input.deterministicSummary?.status !== "evaluated" ||
    input.compositeSummary?.status !== "evaluated" ||
    !validIdentity(input.observedIdentity) ||
    !nonempty(input.evaluatorId) ||
    !nonempty(input.evaluatorVersion) ||
    !nonempty(input.workspaceFingerprint)
  )
    throw new TypeError("Evaluation evidence digest requires a complete evidence bundle");
  const value = {
    expectedIdentity: input.expectedIdentity,
    observedIdentity: input.observedIdentity,
    evaluatorId: input.evaluatorId,
    evaluatorVersion: input.evaluatorVersion,
    workspaceFingerprint: input.workspaceFingerprint,
    deterministicSummary: input.deterministicSummary,
    compositeSummary: input.compositeSummary,
  };
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function validateEvidenceBundle(
  input: EvaluationEvidenceInput,
  deterministic: EvaluatedDeterministicSummary,
  composite: EvaluatedCompositeSummary,
): BenchmarkIneligibilityReason | undefined {
  if (!validIdentity(input.expectedIdentity)) return "evidence_identity_mismatch";
  const deterministicReason = validateEvaluatedDeterministicSummary(deterministic);
  if (deterministicReason !== undefined) return deterministicReason;
  if (
    composite.scenarioId !== input.expectedIdentity.scenarioId ||
    composite.runId !== input.expectedIdentity.runId ||
    composite.modelId !== input.expectedIdentity.modelId ||
    !Array.isArray(composite.skillIds) ||
    composite.skillIds.length !== 1 ||
    composite.skillIds[0] !== input.expectedIdentity.skillId
  )
    return "evidence_identity_mismatch";
  if (!isDeepStrictEqual(composite.deterministicSummary, deterministic)) return "evidence_invalid";
  if (
    input.observedIdentity !== undefined &&
    (!validIdentity(input.observedIdentity) ||
      !sameIdentity(input.observedIdentity, input.expectedIdentity))
  ) {
    return "evidence_identity_mismatch";
  }
  if (
    nonempty(input.workspaceFingerprint) &&
    (input.workspaceFingerprint !== input.expectedIdentity.workspaceFingerprint ||
      input.workspaceFingerprint !== input.observedIdentity?.workspaceFingerprint)
  )
    return "evidence_identity_mismatch";
  if (!validComposite(composite, deterministic)) return "evidence_invalid";
  return undefined;
}

function validComposite(
  composite: EvaluatedCompositeSummary,
  deterministic: EvaluatedDeterministicSummary,
): boolean {
  if (
    !finiteNonnegative(composite.deterministicWeight) ||
    !finiteNonnegative(composite.semanticWeight) ||
    composite.deterministicWeight + composite.semanticWeight <= 0 ||
    !finiteRange(composite.passScoreThreshold, 0, 100) ||
    !finiteRange(composite.compositeScore, 0, 100) ||
    typeof composite.passed !== "boolean" ||
    typeof composite.requireAllDeterministicPass !== "boolean" ||
    typeof composite.evaluatedAt !== "string" ||
    composite.evaluatedAt.trim().length === 0
  )
    return false;
  const judgeScore = composite.judgeEvaluation?.overallScore;
  if (judgeScore !== undefined && !finiteRange(judgeScore, 0, 100)) return false;
  const expectedScore =
    judgeScore === undefined
      ? deterministic.score
      : round(
          (deterministic.score * composite.deterministicWeight +
            judgeScore * composite.semanticWeight) /
            (composite.deterministicWeight + composite.semanticWeight),
        );
  const expectedPass =
    expectedScore >= composite.passScoreThreshold &&
    (!composite.requireAllDeterministicPass || deterministic.passed);
  return composite.compositeScore === expectedScore && composite.passed === expectedPass;
}

function invalidContract(
  evidence: Omit<EvidenceState, "status">,
  reason: BenchmarkIneligibilityReason,
): EvaluationEvidenceContract {
  return {
    evidence: { ...evidence, status: "invalid" },
    evaluation: { status: "invalid", reasons: [reason] },
  };
}

function sameIdentity(left: BenchmarkEvidenceIdentity, right: BenchmarkEvidenceIdentity): boolean {
  return (
    left.runId === right.runId &&
    left.scenarioId === right.scenarioId &&
    left.skillId === right.skillId &&
    left.modelId === right.modelId &&
    left.providerId === right.providerId &&
    left.workspaceFingerprint === right.workspaceFingerprint
  );
}

function validIdentity(
  value: BenchmarkEvidenceIdentity | undefined,
): value is BenchmarkEvidenceIdentity {
  return (
    typeof value === "object" &&
    value !== null &&
    nonempty(value.runId) &&
    nonempty(value.scenarioId) &&
    nonempty(value.skillId) &&
    nonempty(value.modelId) &&
    nonempty(value.providerId) &&
    nonempty(value.workspaceFingerprint)
  );
}

function safeCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function finiteRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function finiteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function nonempty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

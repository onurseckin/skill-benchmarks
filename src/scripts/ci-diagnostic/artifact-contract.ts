import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  type JsonRecord,
  requireAbsent,
  requireCanonicalTimestamp,
  requireCondition,
  requireEqualStringArrays,
  requireExactValue,
  requireRecord,
  requireString,
  requireStringArray,
} from "./assertions.js";
import { requireNoDiagnosticClaims } from "./claims.js";
import type { DiagnosticBundlePaths } from "./filesystem.js";

export interface DiagnosticIdentity {
  readonly sweepId: string;
  readonly planFingerprint: string;
  readonly cellId: string;
  readonly runId: string;
  readonly scenarioId: "git-worktrees";
  readonly category: "coding";
  readonly skillId: "tdd";
  readonly modelId: "gpt-4o";
  readonly providerId: "openai";
}

export interface DiagnosticArtifacts {
  readonly identity: DiagnosticIdentity;
  readonly result: JsonRecord;
  readonly startedAt: string;
  readonly completedAt: string;
}

export const canonicalDiagnosticReasons = [
  "fake_execution",
  "simulated_execution",
  "evaluation_missing",
  "no_required_checks",
  "no_executed_checks",
  "artifact_integrity_unverified",
  "evaluator_identity_missing",
  "evidence_digest_missing",
] as const;

export function requireOperatorLog(path: string, identity: DiagnosticIdentity): void {
  const rawLog = readFileSync(path, "utf8");
  const log = rawLog.replace(/\u001b\[[0-9;]*m/g, "");
  requireCondition(
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(log),
    "artifact_operator_log_invalid",
  );
  const lines = log.split(/\r?\n/).filter((line) => line.trim().length > 0);
  requireExactValue(lines.length, 3, "artifact_operator_log_invalid");
  requireCondition(
    /^─── Executing Skill Benchmark Matrix: 1 scenario\(s\) x 1 skill\(s\) x 1 model\(s\) ───$/.test(
      lines[0] ?? "",
    ),
    "artifact_operator_log_invalid",
  );
  requireCondition(
    new RegExp(
      `^  \\[ COMPLETE \\] ${identity.cellId} \\| Cell ${identity.cellId} completed in [0-9]+(?:\\.[0-9]+)?ms$`,
    ).test(lines[1] ?? ""),
    "artifact_operator_log_invalid",
  );
  requireCondition(
    /^─── Sweep Complete: 1\/1 completed in [0-9]+(?:\.[0-9]+)?s ─+$/.test(lines[2] ?? ""),
    "artifact_operator_log_invalid",
  );
}

export function requireIdentity(
  record: JsonRecord,
  identity: DiagnosticIdentity,
  code: string,
): void {
  requireExactValue(record.sweepId, identity.sweepId, code);
  requireExactValue(record.cellId, identity.cellId, code);
  requireExactValue(record.runId, identity.runId, code);
  requireExactValue(record.scenarioId, identity.scenarioId, code);
  requireExactValue(record.skillId, identity.skillId, code);
  requireExactValue(record.modelId, identity.modelId, code);
  requireExactValue(record.providerId, identity.providerId, code);
  requireExactValue(record.executionMode, "fake", code);
}

export function requireArtifactIdentity(
  record: JsonRecord,
  identity: DiagnosticIdentity,
  code: string,
): void {
  requireIdentity(record, identity, code);
  requireExactValue(record.planFingerprint, identity.planFingerprint, code);
  requireExactValue(record.matrixOccurrenceIndex, 0, code);
  requireExactValue(record.category, identity.category, code);
  requireExactValue(record.simulated, true, code);
  requireExactValue(record.dryRun, false, code);
}

export function requireAuthority(record: JsonRecord, code: string): void {
  requireExactValue(record.benchmarkCohort, "validation", code);
  const eligibility = requireRecord(record.eligibility, code);
  requireExactValue(eligibility.status, "ineligible", code);
  const reasons = requireStringArray(eligibility.reasons, code);
  requireEqualStringArrays(reasons, canonicalDiagnosticReasons, code);
  const evidence = requireRecord(record.evidence, code);
  requireExactValue(evidence.status, "unavailable", code);
  requireExactValue(evidence.requiredChecksDeclared, 0, code);
  requireExactValue(evidence.requiredChecksExecuted, 0, code);
  requireExactValue(evidence.requiredChecksPassed, 0, code);
  requireExactValue(evidence.artifactIntegrity, "unverified", code);
  const evaluation = requireRecord(record.evaluation, code);
  requireExactValue(evaluation.status, "not_evaluated", code);
  requireEqualStringArrays(evaluation.reasons, reasons, code);
  const operationalCost = requireRecord(record.operationalCost, code);
  requireExactValue(operationalCost.status, "simulated_zero", code);
  requireExactValue(operationalCost.amountUSD, 0, code);
  requireAbsent(record, ["compositeScore", "passedBenchmark", "actualCostUSD"], code);
  requireNoDiagnosticClaims(record, code);
}

export function requireMonotonicTimestamps(values: readonly string[], code: string): void {
  const milliseconds = values.map((value) => Date.parse(value));
  requireCondition(
    milliseconds.every(
      (value, index) =>
        index === 0 || value >= (milliseconds[index - 1] ?? Number.POSITIVE_INFINITY),
    ),
    code,
  );
}

export function createDiagnosticIdentity(manifest: JsonRecord): DiagnosticIdentity {
  const sweepId = requireString(manifest.sweepId, "artifact_manifest_identity_invalid");
  const planFingerprint = requireString(
    manifest.planFingerprint,
    "artifact_manifest_identity_invalid",
  );
  const cellId = requireString(manifest.cellId, "artifact_manifest_identity_invalid");
  const runId = requireString(manifest.runId, "artifact_manifest_identity_invalid");
  requireCondition(
    /^[a-z0-9-]+$/.test(sweepId) && /^[a-z0-9-]+$/.test(runId),
    "artifact_manifest_identity_invalid",
  );
  requireExactValue(
    cellId,
    "cell-git-worktrees-tdd-gpt-4o-openai-fake-null-n-5ddf463b7933",
    "artifact_manifest_identity_invalid",
  );
  requireCondition(/^[a-f0-9]{64}$/.test(planFingerprint), "artifact_fingerprint_invalid");
  requireExactValue(manifest.scenarioId, "git-worktrees", "artifact_manifest_identity_invalid");
  requireExactValue(manifest.category, "coding", "artifact_manifest_identity_invalid");
  requireExactValue(manifest.skillId, "tdd", "artifact_manifest_identity_invalid");
  requireExactValue(manifest.modelId, "gpt-4o", "artifact_manifest_identity_invalid");
  requireExactValue(manifest.providerId, "openai", "artifact_manifest_identity_invalid");
  return {
    sweepId,
    planFingerprint,
    cellId,
    runId,
    scenarioId: "git-worktrees",
    category: "coding",
    skillId: "tdd",
    modelId: "gpt-4o",
    providerId: "openai",
  };
}

export function validateDiagnosticArtifactHeaders(
  paths: DiagnosticBundlePaths,
  manifest: JsonRecord,
  result: JsonRecord,
  plan: JsonRecord,
  identity: DiagnosticIdentity,
): { readonly startedAt: string; readonly completedAt: string } {
  requireOperatorLog(paths.log, identity);
  requireExactValue(basename(paths.runDirectory), identity.runId, "artifact_run_directory_invalid");
  requireExactValue(
    basename(paths.sweepDirectory),
    identity.sweepId,
    "artifact_sweep_directory_invalid",
  );
  requireExactValue(manifest.schemaVersion, "1.0.0", "artifact_manifest_contract_invalid");
  requireExactValue(manifest.artifactKind, "manifest", "artifact_manifest_contract_invalid");
  requireArtifactIdentity(manifest, identity, "artifact_manifest_contract_invalid");
  requireNoDiagnosticClaims(manifest, "artifact_manifest_authority_invalid");
  const startedAt = requireCanonicalTimestamp(
    manifest.startedAt,
    "artifact_manifest_timestamp_invalid",
  );
  requireExactValue(manifest.timestamp, startedAt, "artifact_manifest_timestamp_invalid");
  requireExactValue(result.schemaVersion, "2.0.0", "artifact_result_contract_invalid");
  requireExactValue(result.artifactKind, "result", "artifact_result_contract_invalid");
  requireArtifactIdentity(result, identity, "artifact_result_contract_invalid");
  requireExactValue(result.status, "completed", "artifact_result_lifecycle_invalid");
  requireExactValue(result.terminationReason, "success", "artifact_result_lifecycle_invalid");
  requireExactValue(result.attemptCount, 1, "artifact_result_lifecycle_invalid");
  requireExactValue(result.startedAt, startedAt, "artifact_result_timestamp_invalid");
  const completedAt = requireCanonicalTimestamp(
    result.completedAt,
    "artifact_result_timestamp_invalid",
  );
  requireExactValue(result.timestamp, completedAt, "artifact_result_timestamp_invalid");
  requireAuthority(result, "artifact_result_authority_invalid");
  requireExactValue(plan.version, "2", "artifact_plan_contract_invalid");
  requireExactValue(plan.sweepId, identity.sweepId, "artifact_plan_contract_invalid");
  requireExactValue(plan.fingerprint, identity.planFingerprint, "artifact_plan_contract_invalid");
  requireExactValue(Object.keys(plan).length, 3, "artifact_plan_contract_invalid");
  return { startedAt, completedAt };
}

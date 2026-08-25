import { readFileSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  type JsonRecord,
  readJsonRecord,
  requireAbsent,
  requireArray,
  requireCanonicalTimestamp,
  requireCondition,
  requireEqualStringArrays,
  requireExactKeys,
  requireExactValue,
  requireFiniteNumber,
  requireInteger,
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

function requireOperatorLog(path: string, identity: DiagnosticIdentity): void {
  const rawLog = readFileSync(path, "utf8");
  const log = rawLog.replace(/\u001b\[[0-9;]*m/g, "");
  requireCondition(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(log), "artifact_operator_log_invalid");
  const lines = log.split(/\r?\n/).filter((line) => line.trim().length > 0);
  requireExactValue(lines.length, 3, "artifact_operator_log_invalid");
  requireCondition(/^─── Executing Skill Benchmark Matrix: 1 scenario\(s\) x 1 skill\(s\) x 1 model\(s\) ───$/.test(lines[0] ?? ""), "artifact_operator_log_invalid");
  requireCondition(new RegExp(`^  \\[ COMPLETE \\] ${identity.cellId} \\| Cell ${identity.cellId} completed in [0-9]+(?:\\.[0-9]+)?ms$`).test(lines[1] ?? ""), "artifact_operator_log_invalid");
  requireCondition(/^─── Sweep Complete: 1\/1 completed in [0-9]+(?:\.[0-9]+)?s ─+$/.test(lines[2] ?? ""), "artifact_operator_log_invalid");
}

function requireIdentity(record: JsonRecord, identity: DiagnosticIdentity, code: string): void {
  requireExactValue(record.sweepId, identity.sweepId, code);
  requireExactValue(record.cellId, identity.cellId, code);
  requireExactValue(record.runId, identity.runId, code);
  requireExactValue(record.scenarioId, identity.scenarioId, code);
  requireExactValue(record.skillId, identity.skillId, code);
  requireExactValue(record.modelId, identity.modelId, code);
  requireExactValue(record.providerId, identity.providerId, code);
  requireExactValue(record.executionMode, "fake", code);
}

function requireArtifactIdentity(record: JsonRecord, identity: DiagnosticIdentity, code: string): void {
  requireIdentity(record, identity, code);
  requireExactValue(record.planFingerprint, identity.planFingerprint, code);
  requireExactValue(record.matrixOccurrenceIndex, 0, code);
  requireExactValue(record.category, identity.category, code);
  requireExactValue(record.simulated, true, code);
  requireExactValue(record.dryRun, false, code);
}

function requireAuthority(record: JsonRecord, code: string): void {
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

function requireMonotonicTimestamps(values: readonly string[], code: string): void {
  const milliseconds = values.map((value) => Date.parse(value));
  requireCondition(milliseconds.every((value, index) => index === 0 || value >= (milliseconds[index - 1] ?? Number.POSITIVE_INFINITY)), code);
}

function createIdentity(manifest: JsonRecord): DiagnosticIdentity {
  const sweepId = requireString(manifest.sweepId, "artifact_manifest_identity_invalid");
  const planFingerprint = requireString(manifest.planFingerprint, "artifact_manifest_identity_invalid");
  const cellId = requireString(manifest.cellId, "artifact_manifest_identity_invalid");
  const runId = requireString(manifest.runId, "artifact_manifest_identity_invalid");
  requireCondition(/^[a-z0-9-]+$/.test(sweepId) && /^[a-z0-9-]+$/.test(runId), "artifact_manifest_identity_invalid");
  requireExactValue(cellId, "cell-git-worktrees-tdd-gpt-4o-openai-fake-null-n-5ddf463b7933", "artifact_manifest_identity_invalid");
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

export function validateDiagnosticArtifacts(paths: DiagnosticBundlePaths): DiagnosticArtifacts {
  const manifest = readJsonRecord(paths.manifest, "artifact_manifest_json_invalid");
  const result = readJsonRecord(paths.result, "artifact_result_json_invalid");
  const plan = readJsonRecord(paths.plan, "artifact_plan_json_invalid");
  const checkpoint = readJsonRecord(paths.checkpoint, "artifact_checkpoint_json_invalid");
  const outcome = readJsonRecord(paths.outcome, "artifact_outcome_json_invalid");
  const identity = createIdentity(manifest);
  requireOperatorLog(paths.log, identity);
  requireExactValue(basename(paths.runDirectory), identity.runId, "artifact_run_directory_invalid");
  requireExactValue(basename(paths.sweepDirectory), identity.sweepId, "artifact_sweep_directory_invalid");
  requireExactValue(manifest.schemaVersion, "1.0.0", "artifact_manifest_contract_invalid");
  requireExactValue(manifest.artifactKind, "manifest", "artifact_manifest_contract_invalid");
  requireArtifactIdentity(manifest, identity, "artifact_manifest_contract_invalid");
  requireNoDiagnosticClaims(manifest, "artifact_manifest_authority_invalid");
  const startedAt = requireCanonicalTimestamp(manifest.startedAt, "artifact_manifest_timestamp_invalid");
  requireExactValue(manifest.timestamp, startedAt, "artifact_manifest_timestamp_invalid");
  requireExactValue(result.schemaVersion, "2.0.0", "artifact_result_contract_invalid");
  requireExactValue(result.artifactKind, "result", "artifact_result_contract_invalid");
  requireArtifactIdentity(result, identity, "artifact_result_contract_invalid");
  requireExactValue(result.status, "completed", "artifact_result_lifecycle_invalid");
  requireExactValue(result.terminationReason, "success", "artifact_result_lifecycle_invalid");
  requireExactValue(result.attemptCount, 1, "artifact_result_lifecycle_invalid");
  requireExactValue(result.startedAt, startedAt, "artifact_result_timestamp_invalid");
  const completedAt = requireCanonicalTimestamp(result.completedAt, "artifact_result_timestamp_invalid");
  requireExactValue(result.timestamp, completedAt, "artifact_result_timestamp_invalid");
  requireAuthority(result, "artifact_result_authority_invalid");
  requireExactValue(plan.version, "2", "artifact_plan_contract_invalid");
  requireExactValue(plan.sweepId, identity.sweepId, "artifact_plan_contract_invalid");
  requireExactValue(plan.fingerprint, identity.planFingerprint, "artifact_plan_contract_invalid");
  requireExactValue(Object.keys(plan).length, 3, "artifact_plan_contract_invalid");
  const metadata = requireRecord(checkpoint.metadata, "artifact_checkpoint_contract_invalid");
  requireExactValue(metadata.version, "2.0.0", "artifact_checkpoint_contract_invalid");
  requireExactValue(metadata.sweepId, identity.sweepId, "artifact_checkpoint_contract_invalid");
  requireExactValue(metadata.planFingerprint, identity.planFingerprint, "artifact_checkpoint_contract_invalid");
  requireExactValue(metadata.bunVersion, "1.3.14", "artifact_checkpoint_runtime_invalid");
  requireString(metadata.hostArch, "artifact_checkpoint_runtime_invalid");
  requireExactValue(checkpoint.status, "completed", "artifact_checkpoint_lifecycle_invalid");
  requireExactValue(checkpoint.totalPlannedCells, 1, "artifact_checkpoint_lifecycle_invalid");
  requireEqualStringArrays(checkpoint.completedCellIds, [identity.cellId], "artifact_checkpoint_lifecycle_invalid");
  requireEqualStringArrays(checkpoint.failedCellIds, [], "artifact_checkpoint_lifecycle_invalid");
  requireEqualStringArrays(checkpoint.skippedCellIds, [], "artifact_checkpoint_lifecycle_invalid");
  const completedResults = requireRecord(checkpoint.completedResults, "artifact_checkpoint_result_invalid");
  requireEqualStringArrays(Object.keys(completedResults), [identity.cellId], "artifact_checkpoint_result_invalid");
  const completedResult = requireRecord(completedResults[identity.cellId], "artifact_checkpoint_result_invalid");
  const cell = requireRecord(completedResult.cell, "artifact_checkpoint_cell_invalid");
  requireIdentity(cell, identity, "artifact_checkpoint_cell_invalid");
  requireExactValue(cell.matrixOccurrenceIndex, 0, "artifact_checkpoint_cell_invalid");
  requireExactValue(cell.repetitionIndex, 0, "artifact_checkpoint_cell_invalid");
  requireCondition(isAbsolute(requireString(cell.outputRoot, "artifact_checkpoint_cell_invalid")), "artifact_checkpoint_cell_invalid");
  const modelEntry = requireRecord(cell.modelEntry, "artifact_checkpoint_cell_invalid");
  requireExactValue(modelEntry.modelId, identity.modelId, "artifact_checkpoint_cell_invalid");
  requireExactValue(modelEntry.providerId, identity.providerId, "artifact_checkpoint_cell_invalid");
  requireExactValue(completedResult.status, "completed", "artifact_checkpoint_result_invalid");
  requireExactValue(completedResult.retryable, false, "artifact_checkpoint_result_invalid");
  requireExactValue(completedResult.executionCompleted, true, "artifact_checkpoint_result_invalid");
  requireExactValue(completedResult.benchmarkCohort, "validation", "artifact_checkpoint_result_invalid");
  requireExactValue(completedResult.eligibilityStatus, "ineligible", "artifact_checkpoint_result_invalid");
  requireExactValue(completedResult.evaluationStatus, "not_evaluated", "artifact_checkpoint_result_invalid");
  requireAbsent(completedResult, ["passedBenchmark", "compositeScore", "actualCostUSD", "error"], "artifact_checkpoint_result_invalid");
  const checkpointRunRecord = requireRecord(completedResult.runRecord, "artifact_checkpoint_record_invalid");
  requireArtifactIdentity(checkpointRunRecord, identity, "artifact_checkpoint_record_invalid");
  requireExactValue(checkpointRunRecord.status, "completed", "artifact_checkpoint_record_invalid");
  requireExactValue(checkpointRunRecord.terminationReason, "success", "artifact_checkpoint_record_invalid");
  requireExactValue(checkpointRunRecord.startedAt, startedAt, "artifact_checkpoint_record_invalid");
  requireExactValue(checkpointRunRecord.completedAt, completedAt, "artifact_checkpoint_record_invalid");
  requireAuthority(checkpointRunRecord, "artifact_checkpoint_authority_invalid");
  const scenarioResult = requireRecord(completedResult.scenarioResult, "artifact_scenario_result_invalid");
  requireExactValue(scenarioResult.runId, identity.runId, "artifact_scenario_result_invalid");
  requireExactValue(scenarioResult.scenarioId, identity.scenarioId, "artifact_scenario_result_invalid");
  requireEqualStringArrays(scenarioResult.skillIds, [identity.skillId], "artifact_scenario_result_invalid");
  requireExactValue(scenarioResult.modelId, identity.modelId, "artifact_scenario_result_invalid");
  requireExactValue(scenarioResult.executionMode, "fake", "artifact_scenario_result_invalid");
  requireExactValue(scenarioResult.simulated, true, "artifact_scenario_result_invalid");
  requireExactValue(scenarioResult.terminationReason, "success", "artifact_scenario_result_invalid");
  requireExactValue(scenarioResult.completed, true, "artifact_scenario_result_invalid");
  requireExactValue(scenarioResult.totalCostUSD, 0, "artifact_scenario_result_invalid");
  requireExactValue(scenarioResult.finalOutput, "Fake benchmark trajectory completed successfully.", "artifact_scenario_result_invalid");
  const durationMs = requireFiniteNumber(result.totalDurationMs, "artifact_metric_reconciliation_invalid");
  requireCondition(durationMs >= 0, "artifact_metric_reconciliation_invalid");
  const totalTokens = requireInteger(result.totalTokens, "artifact_metric_reconciliation_invalid");
  const totalTurns = requireInteger(result.totalTurns, "artifact_metric_reconciliation_invalid");
  const toolErrorCount = requireInteger(result.toolErrorCount, "artifact_metric_reconciliation_invalid");
  requireCondition(totalTokens >= 0 && totalTurns >= 0 && toolErrorCount >= 0, "artifact_metric_reconciliation_invalid");
  requireExactValue(completedResult.attemptCount, 1, "artifact_metric_reconciliation_invalid");
  requireExactValue(completedResult.startedAt, startedAt, "artifact_metric_reconciliation_invalid");
  requireExactValue(completedResult.completedAt, completedAt, "artifact_metric_reconciliation_invalid");
  requireExactValue(completedResult.durationMs, durationMs, "artifact_metric_reconciliation_invalid");
  requireExactValue(checkpoint.wallClockDurationMs, durationMs, "artifact_metric_reconciliation_invalid");
  requireExactValue(checkpoint.totalCostUSD, 0, "artifact_metric_reconciliation_invalid");
  requireExactValue(checkpointRunRecord.wallClockMs, durationMs, "artifact_metric_reconciliation_invalid");
  requireExactValue(checkpointRunRecord.totalTokens, totalTokens, "artifact_metric_reconciliation_invalid");
  requireExactValue(checkpointRunRecord.totalTurns, totalTurns, "artifact_metric_reconciliation_invalid");
  requireExactValue(checkpointRunRecord.errorCount, toolErrorCount, "artifact_metric_reconciliation_invalid");
  requireExactValue(scenarioResult.totalDurationMs, durationMs, "artifact_metric_reconciliation_invalid");
  requireExactValue(scenarioResult.turns, totalTurns, "artifact_metric_reconciliation_invalid");
  requireExactValue(scenarioResult.startedAt, result.scenarioStartedAt, "artifact_metric_reconciliation_invalid");
  requireExactValue(scenarioResult.finishedAt, result.scenarioCompletedAt, "artifact_metric_reconciliation_invalid");
  requireCondition(isDeepStrictEqual(scenarioResult.totalTokens, result.usageBreakdown), "artifact_metric_reconciliation_invalid");
  requireCondition(isDeepStrictEqual(checkpoint.totalTokens, result.usageBreakdown), "artifact_metric_reconciliation_invalid");
  const usageBreakdown = requireRecord(result.usageBreakdown, "artifact_metric_reconciliation_invalid");
  requireExactKeys(usageBreakdown, ["inputTokens", "outputTokens", "cacheCreationInputTokens", "cacheReadInputTokens", "totalTokens"], "artifact_metric_reconciliation_invalid");
  const inputTokens = requireInteger(usageBreakdown.inputTokens, "artifact_metric_reconciliation_invalid");
  const outputTokens = requireInteger(usageBreakdown.outputTokens, "artifact_metric_reconciliation_invalid");
  const cacheCreationTokens = requireInteger(usageBreakdown.cacheCreationInputTokens, "artifact_metric_reconciliation_invalid");
  const cacheReadTokens = requireInteger(usageBreakdown.cacheReadInputTokens, "artifact_metric_reconciliation_invalid");
  requireCondition(inputTokens >= 0 && outputTokens >= 0 && cacheCreationTokens >= 0 && cacheReadTokens >= 0, "artifact_metric_reconciliation_invalid");
  requireCondition(inputTokens + outputTokens === totalTokens, "artifact_metric_reconciliation_invalid");
  requireCondition(cacheCreationTokens <= inputTokens && cacheReadTokens <= inputTokens && cacheCreationTokens + cacheReadTokens <= inputTokens, "artifact_metric_reconciliation_invalid");
  requireExactValue(usageBreakdown.totalTokens, totalTokens, "artifact_metric_reconciliation_invalid");
  requireExactValue(outcome.schemaVersion, "1.0.0", "artifact_outcome_contract_invalid");
  requireExactValue(outcome.artifactKind, "sweep-outcome", "artifact_outcome_contract_invalid");
  requireExactValue(outcome.sweepId, identity.sweepId, "artifact_outcome_contract_invalid");
  requireExactValue(outcome.planFingerprint, identity.planFingerprint, "artifact_outcome_contract_invalid");
  requireExactValue(outcome.status, "completed", "artifact_outcome_lifecycle_invalid");
  requireExactValue(outcome.terminationReason, "success", "artifact_outcome_lifecycle_invalid");
  requireExactValue(outcome.totalPlannedCells, 1, "artifact_outcome_lifecycle_invalid");
  requireExactValue(outcome.completedCount, 1, "artifact_outcome_lifecycle_invalid");
  requireExactValue(outcome.failedCount, 0, "artifact_outcome_lifecycle_invalid");
  requireExactValue(outcome.abortedCount, 0, "artifact_outcome_lifecycle_invalid");
  requireExactValue(outcome.skippedCount, 0, "artifact_outcome_lifecycle_invalid");
  const terminalCells = requireArray(outcome.terminalCells, "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCells.length, 1, "artifact_outcome_terminal_invalid");
  const terminalCell = requireRecord(terminalCells[0], "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.cellId, identity.cellId, "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.runId, identity.runId, "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.scenarioId, identity.scenarioId, "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.skillId, identity.skillId, "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.modelId, identity.modelId, "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.providerId, identity.providerId, "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.executionMode, "fake", "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.matrixOccurrenceIndex, 0, "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.simulated, true, "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.status, "completed", "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.terminationReason, "success", "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.benchmarkCohort, "validation", "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.eligibilityStatus, "ineligible", "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.evaluationStatus, "not_evaluated", "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.evidenceDurable, true, "artifact_outcome_terminal_invalid");
  requireExactValue(terminalCell.publicStatus, "completed", "artifact_outcome_terminal_invalid");
  requireNoDiagnosticClaims(outcome, "artifact_outcome_authority_invalid");
  const sweepStartedAt = requireCanonicalTimestamp(metadata.sweepStartedAt, "artifact_checkpoint_timestamp_invalid");
  const checkpointCreatedAt = requireCanonicalTimestamp(metadata.createdAt, "artifact_checkpoint_timestamp_invalid");
  const checkpointUpdatedAt = requireCanonicalTimestamp(metadata.updatedAt, "artifact_checkpoint_timestamp_invalid");
  requireExactValue(outcome.startedAt, sweepStartedAt, "artifact_outcome_timestamp_invalid");
  requireExactValue(outcome.completedAt, checkpointUpdatedAt, "artifact_outcome_timestamp_invalid");
  requireMonotonicTimestamps([sweepStartedAt, checkpointCreatedAt, startedAt, completedAt, checkpointUpdatedAt], "artifact_timestamp_order_invalid");
  const configSummary = requireRecord(checkpoint.configSummary, "artifact_checkpoint_config_invalid");
  requireEqualStringArrays(configSummary.scenarioIds, [identity.scenarioId], "artifact_checkpoint_config_invalid");
  requireEqualStringArrays(configSummary.skillIds, [identity.skillId], "artifact_checkpoint_config_invalid");
  requireEqualStringArrays(configSummary.modelIds, [identity.modelId], "artifact_checkpoint_config_invalid");
  requireExactValue(requireInteger(configSummary.repetitions, "artifact_checkpoint_config_invalid"), 1, "artifact_checkpoint_config_invalid");
  requireNoDiagnosticClaims(checkpoint, "artifact_checkpoint_authority_invalid");
  return { identity, result, startedAt, completedAt };
}

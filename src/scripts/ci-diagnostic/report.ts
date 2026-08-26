import {
  type JsonRecord,
  readJsonRecord,
  requireArray,
  requireCanonicalTimestamp,
  requireCondition,
  requireExactValue,
  requireRecord,
  requireStringArray,
} from "./assertions.js";
import { canonicalDiagnosticReasons, type DiagnosticArtifacts } from "./artifacts.js";
import { requireNoDiagnosticClaims } from "./claims.js";

function requireCount(record: JsonRecord, key: string, expected: number): void {
  requireExactValue(record[key], expected, "report_provenance_invalid");
}

export function validateDiagnosticReport(path: string, artifacts: DiagnosticArtifacts): void {
  const report = readJsonRecord(path, "report_json_invalid");
  requireExactValue(report.schemaVersion, "1.0.0", "report_schema_invalid");
  const generatedAt = requireCanonicalTimestamp(report.generatedAt, "report_timestamp_invalid");
  requireCondition(
    Date.parse(generatedAt) >= Date.parse(artifacts.completedAt),
    "report_timestamp_invalid",
  );
  const filter = requireRecord(report.filter, "report_filter_invalid");
  requireExactValue(Object.keys(filter).length, 0, "report_filter_invalid");
  requireExactValue(report.matchedRunCount, 1, "report_cohort_invalid");
  requireExactValue(report.eligibleRunCount, 0, "report_cohort_invalid");
  requireExactValue(report.diagnosticRunCount, 1, "report_cohort_invalid");
  requireExactValue(
    requireArray(report.leaderboard, "report_leaderboard_invalid").length,
    0,
    "report_leaderboard_invalid",
  );
  requireExactValue(
    requireArray(report.categoryLeaderboards, "report_leaderboard_invalid").length,
    0,
    "report_leaderboard_invalid",
  );
  const provenance = requireRecord(report.provenance, "report_provenance_invalid");
  const executionModes = requireRecord(provenance.executionModeCounts, "report_provenance_invalid");
  requireCount(executionModes, "fake", 1);
  requireCount(executionModes, "live", 0);
  requireCount(provenance, "simulatedRunCount", 1);
  requireCount(provenance, "nonSimulatedRunCount", 0);
  const cohorts = requireRecord(provenance.cohortCounts, "report_provenance_invalid");
  requireCount(cohorts, "eligible", 0);
  requireCount(cohorts, "validation", 1);
  requireCount(cohorts, "operational", 0);
  const eligibility = requireRecord(provenance.eligibilityCounts, "report_provenance_invalid");
  requireCount(eligibility, "eligible", 0);
  requireCount(eligibility, "ineligible", 1);
  requireCount(eligibility, "unknown", 0);
  const evaluations = requireRecord(provenance.evaluationStatusCounts, "report_provenance_invalid");
  requireCount(evaluations, "not_requested", 0);
  requireCount(evaluations, "not_evaluated", 1);
  requireCount(evaluations, "evaluated", 0);
  requireCount(evaluations, "invalid", 0);
  const evidence = requireRecord(provenance.evidenceStatusCounts, "report_provenance_invalid");
  requireCount(evidence, "unavailable", 1);
  requireCount(evidence, "collecting", 0);
  requireCount(evidence, "complete", 0);
  requireCount(evidence, "invalid", 0);
  const lifecycle = requireRecord(provenance.lifecycleStatusCounts, "report_provenance_invalid");
  requireCount(lifecycle, "completed", 1);
  requireCount(lifecycle, "failed", 0);
  requireCount(lifecycle, "timed_out", 0);
  requireCount(lifecycle, "aborted", 0);
  requireExactValue(
    provenance.evidenceThrough,
    artifacts.completedAt,
    "report_evidence_timestamp_invalid",
  );
  const resultEligibility = requireRecord(artifacts.result.eligibility, "report_reason_invalid");
  const expectedReasons = requireStringArray(resultEligibility.reasons, "report_reason_invalid");
  requireExactValue(
    expectedReasons.length,
    canonicalDiagnosticReasons.length,
    "report_reason_invalid",
  );
  const reasonRows = requireArray(provenance.eligibilityReasonCounts, "report_reason_invalid");
  requireExactValue(reasonRows.length, expectedReasons.length, "report_reason_invalid");
  for (const [index, reason] of expectedReasons.entries()) {
    const row = requireRecord(reasonRows[index], "report_reason_invalid");
    requireExactValue(row.reason, reason, "report_reason_invalid");
    requireExactValue(row.count, 1, "report_reason_invalid");
  }
  requireNoDiagnosticClaims(report, "report_claim_present");
}

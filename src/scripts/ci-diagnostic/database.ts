import { Database } from "bun:sqlite";
import { lstatSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { reportingSchemaVersion, validateReportingSchema } from "../../reporting/schema.js";
import {
  DiagnosticVerificationError,
  type JsonRecord,
  failVerification,
  requireCondition,
  requireEqualStringArrays,
  requireExactValue,
  requireInteger,
  requireNull,
  requireRecord,
  requireStringArray,
} from "./assertions.js";
import { canonicalDiagnosticReasons, type DiagnosticArtifacts } from "./artifacts.js";

const canonicalSchemaObjects = [
  "index:idx_runs_category:runs",
  "index:idx_runs_completed_at:runs",
  "index:idx_runs_eligibility:runs",
  "index:idx_runs_model_id:runs",
  "index:idx_runs_provider_id:runs",
  "index:idx_runs_scenario_id:runs",
  "index:idx_runs_skill_completed:runs",
  "index:idx_runs_skill_id:runs",
  "index:idx_runs_started_at:runs",
  "index:idx_runs_status:runs",
  "index:idx_telemetry_event_type:telemetry_events",
  "index:idx_telemetry_run_id:telemetry_events",
  "index:idx_telemetry_timestamp:telemetry_events",
  "index:sqlite_autoindex_run_claims_1:run_claims",
  "index:sqlite_autoindex_runs_1:runs",
  "table:run_claims:run_claims",
  "table:runs:runs",
  "table:sqlite_sequence:sqlite_sequence",
  "table:telemetry_events:telemetry_events",
] as const;

interface DatabaseRunRow extends JsonRecord {
  readonly run_id: string;
  readonly sweep_id: string;
  readonly plan_fingerprint: string;
  readonly cell_id: string;
  readonly matrix_occurrence_index: number;
  readonly scenario_id: string;
  readonly category: string;
  readonly skill_id: string;
  readonly model_id: string;
  readonly provider_id: string;
  readonly execution_mode: string;
  readonly simulated: number;
  readonly dry_run: number;
  readonly status: string;
  readonly termination_reason: string;
  readonly benchmark_cohort: string;
  readonly eligibility_status: string;
  readonly eligibility_reasons_json: string;
  readonly evidence_status: string;
  readonly evaluation_status: string;
  readonly required_checks_declared: number;
  readonly required_checks_executed: number;
  readonly required_checks_passed: number;
  readonly artifact_integrity_status: string;
  readonly evaluator_id: null;
  readonly evaluator_version: null;
  readonly evidence_digest: null;
  readonly evidence_identity_json: null;
  readonly composite_score: null;
  readonly passed_benchmark: null;
  readonly operational_cost_usd: number;
  readonly cost_evidence_status: string;
  readonly actual_cost_usd: null;
  readonly cost_pricing_identity: null;
  readonly cost_usage_digest: null;
  readonly attempt_count: number;
  readonly wall_clock_ms: number;
  readonly total_tokens: number;
  readonly cache_hit_ratio: number;
  readonly total_turns: number;
  readonly error_count: number;
  readonly started_at: string;
  readonly completed_at: string;
  readonly manifest_json: null;
  readonly metrics_json: null;
  readonly evaluation_json: string;
}

function parseJson(value: string, code: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return failVerification(code);
  }
}

function validateRunRow(row: DatabaseRunRow, artifacts: DiagnosticArtifacts): void {
  const identity = artifacts.identity;
  requireExactValue(row.run_id, identity.runId, "database_run_identity_invalid");
  requireExactValue(row.sweep_id, identity.sweepId, "database_run_identity_invalid");
  requireExactValue(row.plan_fingerprint, identity.planFingerprint, "database_run_identity_invalid");
  requireExactValue(row.cell_id, identity.cellId, "database_run_identity_invalid");
  requireExactValue(row.matrix_occurrence_index, 0, "database_run_identity_invalid");
  requireExactValue(row.scenario_id, identity.scenarioId, "database_run_identity_invalid");
  requireExactValue(row.category, identity.category, "database_run_identity_invalid");
  requireExactValue(row.skill_id, identity.skillId, "database_run_identity_invalid");
  requireExactValue(row.model_id, identity.modelId, "database_run_identity_invalid");
  requireExactValue(row.provider_id, identity.providerId, "database_run_identity_invalid");
  requireExactValue(row.execution_mode, "fake", "database_provenance_invalid");
  requireExactValue(row.simulated, 1, "database_provenance_invalid");
  requireExactValue(row.dry_run, 0, "database_provenance_invalid");
  requireExactValue(row.status, "completed", "database_lifecycle_invalid");
  requireExactValue(row.termination_reason, "success", "database_lifecycle_invalid");
  requireExactValue(row.benchmark_cohort, "validation", "database_authority_invalid");
  requireExactValue(row.eligibility_status, "ineligible", "database_authority_invalid");
  requireExactValue(row.evidence_status, "unavailable", "database_authority_invalid");
  requireExactValue(row.evaluation_status, "not_evaluated", "database_authority_invalid");
  requireExactValue(row.required_checks_declared, 0, "database_authority_invalid");
  requireExactValue(row.required_checks_executed, 0, "database_authority_invalid");
  requireExactValue(row.required_checks_passed, 0, "database_authority_invalid");
  requireExactValue(row.artifact_integrity_status, "unverified", "database_authority_invalid");
  requireExactValue(row.operational_cost_usd, 0, "database_cost_invalid");
  requireExactValue(row.cost_evidence_status, "simulated_zero", "database_cost_invalid");
  requireExactValue(row.attempt_count, 1, "database_lifecycle_invalid");
  requireExactValue(row.wall_clock_ms, artifacts.result.totalDurationMs, "database_metric_reconciliation_invalid");
  requireExactValue(row.total_tokens, artifacts.result.totalTokens, "database_metric_reconciliation_invalid");
  requireExactValue(row.total_turns, artifacts.result.totalTurns, "database_metric_reconciliation_invalid");
  requireExactValue(row.error_count, artifacts.result.toolErrorCount, "database_metric_reconciliation_invalid");
  const usage = requireRecord(artifacts.result.usageBreakdown, "database_metric_reconciliation_invalid");
  const cacheReadTokens = requireInteger(usage.cacheReadInputTokens, "database_metric_reconciliation_invalid");
  const totalTokens = requireInteger(usage.totalTokens, "database_metric_reconciliation_invalid");
  requireCondition(totalTokens > 0 && cacheReadTokens >= 0 && row.cache_hit_ratio >= 0 && row.cache_hit_ratio <= 1, "database_metric_reconciliation_invalid");
  requireExactValue(row.cache_hit_ratio, cacheReadTokens / totalTokens, "database_metric_reconciliation_invalid");
  requireExactValue(row.started_at, artifacts.startedAt, "database_timestamp_invalid");
  requireExactValue(row.completed_at, artifacts.completedAt, "database_timestamp_invalid");
  requireNull(row, [
    "evaluator_id",
    "evaluator_version",
    "evidence_digest",
    "evidence_identity_json",
    "composite_score",
    "passed_benchmark",
    "actual_cost_usd",
    "cost_pricing_identity",
    "cost_usage_digest",
    "manifest_json",
    "metrics_json",
  ], "database_claim_absence_invalid");
  const eligibility = requireRecord(artifacts.result.eligibility, "database_authority_invalid");
  requireStringArray(eligibility.reasons, "database_authority_invalid");
  requireEqualStringArrays(parseJson(row.eligibility_reasons_json, "database_authority_invalid"), canonicalDiagnosticReasons, "database_authority_invalid");
  const evaluation = parseJson(row.evaluation_json, "database_evaluation_invalid");
  requireCondition(isDeepStrictEqual(evaluation, artifacts.result.evaluation), "database_evaluation_invalid");
}

export function validateDiagnosticDatabase(path: string, artifacts: DiagnosticArtifacts): void {
  const before = lstatSync(path);
  let database: Database;
  try {
    database = new Database(path, { readonly: true, strict: true });
  } catch {
    return failVerification("database_open_invalid");
  }
  try {
    validateReportingSchema(database);
    const version = database.query("PRAGMA user_version").get() as JsonRecord | null;
    requireCondition(version !== null, "database_schema_version_invalid");
    requireExactValue(version.user_version, reportingSchemaVersion, "database_schema_version_invalid");
    const schemaObjects = database.query("SELECT type, name, tbl_name FROM sqlite_master ORDER BY type, name").all() as readonly JsonRecord[];
    const schemaIdentities = schemaObjects.map((row) => `${String(row.type)}:${String(row.name)}:${String(row.tbl_name)}`);
    requireEqualStringArrays(schemaIdentities, canonicalSchemaObjects, "database_schema_shape_invalid");
    const runs = database.query(`SELECT
      run_id, sweep_id, plan_fingerprint, cell_id, matrix_occurrence_index,
      scenario_id, category, skill_id, model_id, provider_id, execution_mode,
      simulated, dry_run, status, termination_reason, benchmark_cohort,
      eligibility_status, eligibility_reasons_json, evidence_status, evaluation_status,
      required_checks_declared, required_checks_executed, required_checks_passed,
      artifact_integrity_status, evaluator_id, evaluator_version, evidence_digest,
      evidence_identity_json, composite_score, passed_benchmark, operational_cost_usd,
      cost_evidence_status, actual_cost_usd, cost_pricing_identity, cost_usage_digest,
      attempt_count, wall_clock_ms, total_tokens, cache_hit_ratio, total_turns, error_count,
      started_at, completed_at, manifest_json, metrics_json, evaluation_json
      FROM runs`).all() as readonly DatabaseRunRow[];
    requireExactValue(runs.length, 1, "database_run_count_invalid");
    const run = runs[0];
    requireCondition(run !== undefined, "database_run_count_invalid");
    validateRunRow(run, artifacts);
    const eligibleCount = database.query("SELECT COUNT(*) AS count FROM runs WHERE eligibility_status = 'eligible'").get() as JsonRecord | null;
    requireCondition(eligibleCount !== null, "database_eligibility_count_invalid");
    requireExactValue(eligibleCount.count, 0, "database_eligibility_count_invalid");
    const claims = database.query("SELECT run_id, sweep_id, cell_id FROM run_claims").all() as readonly JsonRecord[];
    requireExactValue(claims.length, 0, "database_claim_count_invalid");
    const telemetryCount = database.query("SELECT COUNT(*) AS count FROM telemetry_events").get() as JsonRecord | null;
    requireCondition(telemetryCount !== null, "database_event_count_invalid");
    requireExactValue(telemetryCount.count, 0, "database_event_count_invalid");
  } catch (error) {
    if (error instanceof DiagnosticVerificationError) throw error;
    failVerification("database_contract_invalid");
  } finally {
    database.close();
  }
  const after = lstatSync(path);
  requireCondition(
    before.dev === after.dev
      && before.ino === after.ino
      && before.size === after.size
      && before.mtimeMs === after.mtimeMs
      && before.ctimeMs === after.ctimeMs
      && before.nlink === after.nlink,
    "database_readonly_mutation_detected"
  );
}

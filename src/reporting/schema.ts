import type { Database } from "bun:sqlite";

export const reportingSchemaVersion = 3;

const legacyRunColumns = new Set([
  "run_id", "sweep_id", "plan_fingerprint", "cell_id", "matrix_occurrence_index",
  "scenario_id", "category", "skill_id", "skill_version", "model_id", "provider_id",
  "execution_mode", "simulated", "thinking_level", "thinking_budget_tokens", "reasoning_tokens",
  "status", "termination_reason", "composite_score", "passed_benchmark", "wall_clock_ms",
  "total_tokens", "cache_hit_ratio", "total_cost_usd", "total_turns", "error_count",
  "attempt_count", "started_at", "completed_at", "manifest_json", "metrics_json",
  "evaluation_json", "commit_sha",
]);

const authorityRunColumns = new Set([
  "run_id", "sweep_id", "plan_fingerprint", "cell_id", "matrix_occurrence_index",
  "scenario_id", "category", "skill_id", "skill_version", "model_id", "provider_id",
  "execution_mode", "simulated", "dry_run", "thinking_level", "thinking_budget_tokens",
  "reasoning_tokens", "status", "termination_reason", "benchmark_cohort", "eligibility_status",
  "eligibility_reasons_json", "evidence_status", "evaluation_status", "required_checks_declared",
  "required_checks_executed", "required_checks_passed", "artifact_integrity_status",
  "evaluator_id", "evaluator_version", "evidence_digest", "evidence_identity_json",
  "composite_score", "passed_benchmark", "operational_cost_usd", "cost_evidence_status",
  "actual_cost_usd", "cost_pricing_identity", "cost_usage_digest", "wall_clock_ms",
  "total_tokens", "cache_hit_ratio", "total_turns", "error_count", "attempt_count",
  "started_at", "completed_at", "manifest_json", "metrics_json", "evaluation_json", "commit_sha",
]);

const runClaimColumns = new Set(["run_id", "sweep_id", "cell_id", "created_at"]);
const telemetryColumns = new Set([
  "id", "run_id", "scenario_id", "skill_id", "model_id", "timestamp_us",
  "event_type", "sequence_number", "payload_json",
]);
const retiredEloColumns = new Set([
  "skill_id", "rating", "matches_played", "wins", "losses", "ties", "last_updated",
]);

export function initializeReportingSchema(database: Database): void {
  const version = readUserVersion(database);
  const runColumns = readColumns(database, "runs");
  if (version === reportingSchemaVersion) {
    validateReportingSchema(database);
    configureDatabase(database);
    return;
  }
  if (version === 2) {
    migrateVersionTwoSchema(database);
    validateReportingSchema(database);
    configureDatabase(database);
    return;
  }
  if (version !== 0) throw new TypeError("Unsupported benchmark database schema version");
  if (runColumns.length > 0) assertExactColumns(runColumns, legacyRunColumns);
  assertExistingSupportingSchema(database);
  database.transaction(() => {
    if (runColumns.length === 0) createAuthoritySchema(database);
    else migrateLegacyRuns(database);
    createSupportingSchema(database);
    database.exec("DROP INDEX IF EXISTS idx_elo_rating; DROP TABLE IF EXISTS elo_ratings; DELETE FROM run_claims;");
    database.exec(`PRAGMA user_version = ${reportingSchemaVersion};`);
  })();
  validateReportingSchema(database);
  configureDatabase(database);
}

export function validateReportingSchema(database: Database): void {
  if (readUserVersion(database) !== reportingSchemaVersion) throw new TypeError("Unsupported benchmark database schema version");
  assertExactColumns(readColumns(database, "runs"), authorityRunColumns);
  assertExactColumns(readColumns(database, "run_claims"), runClaimColumns);
  assertExactColumns(readColumns(database, "telemetry_events"), telemetryColumns);
  if (readColumns(database, "elo_ratings").length !== 0) throw new TypeError("Unsupported ranked history table");
}

function configureDatabase(database: Database): void {
  database.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY;");
}

function createAuthoritySchema(database: Database): void {
  database.exec(`
    CREATE TABLE runs (
      run_id TEXT PRIMARY KEY,
      sweep_id TEXT,
      plan_fingerprint TEXT,
      cell_id TEXT,
      matrix_occurrence_index INTEGER,
      scenario_id TEXT NOT NULL,
      category TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      skill_version TEXT,
      model_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      execution_mode TEXT NOT NULL CHECK(execution_mode IN ('fake', 'live')),
      simulated INTEGER NOT NULL CHECK(simulated IN (0, 1)),
      dry_run INTEGER NOT NULL CHECK(dry_run IN (0, 1)),
      thinking_level TEXT,
      thinking_budget_tokens INTEGER,
      reasoning_tokens INTEGER,
      status TEXT NOT NULL CHECK(status IN ('completed', 'failed', 'timed_out', 'aborted')),
      termination_reason TEXT,
      benchmark_cohort TEXT NOT NULL CHECK(benchmark_cohort IN ('eligible', 'validation', 'operational')),
      eligibility_status TEXT NOT NULL CHECK(eligibility_status IN ('eligible', 'ineligible', 'unknown')),
      eligibility_reasons_json TEXT NOT NULL,
      evidence_status TEXT NOT NULL CHECK(evidence_status IN ('unavailable', 'collecting', 'complete', 'invalid')),
      evaluation_status TEXT NOT NULL CHECK(evaluation_status IN ('not_requested', 'not_evaluated', 'evaluated', 'invalid')),
      required_checks_declared INTEGER,
      required_checks_executed INTEGER,
      required_checks_passed INTEGER,
      artifact_integrity_status TEXT NOT NULL CHECK(artifact_integrity_status IN ('unverified', 'verified', 'invalid')),
      evaluator_id TEXT,
      evaluator_version TEXT,
      evidence_digest TEXT,
      evidence_identity_json TEXT,
      composite_score REAL,
      passed_benchmark INTEGER,
      operational_cost_usd REAL NOT NULL CHECK(operational_cost_usd >= 0),
      cost_evidence_status TEXT NOT NULL CHECK(cost_evidence_status IN ('simulated_zero', 'unverified', 'verified')),
      actual_cost_usd REAL,
      cost_pricing_identity TEXT,
      cost_usage_digest TEXT,
      wall_clock_ms REAL NOT NULL CHECK(wall_clock_ms >= 0),
      total_tokens INTEGER NOT NULL CHECK(total_tokens >= 0),
      cache_hit_ratio REAL NOT NULL CHECK(cache_hit_ratio >= 0 AND cache_hit_ratio <= 1),
      total_turns INTEGER NOT NULL CHECK(total_turns >= 0),
      error_count INTEGER NOT NULL CHECK(error_count >= 0),
      attempt_count INTEGER NOT NULL CHECK(attempt_count >= 0),
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      manifest_json TEXT,
      metrics_json TEXT,
      evaluation_json TEXT,
      commit_sha TEXT,
      CHECK(
        (required_checks_declared IS NULL AND required_checks_executed IS NULL AND required_checks_passed IS NULL)
        OR (required_checks_declared >= 0 AND required_checks_executed >= 0 AND required_checks_passed >= 0
          AND required_checks_passed <= required_checks_executed AND required_checks_executed <= required_checks_declared)
      ),
      CHECK(
        eligibility_status != 'eligible'
        OR (benchmark_cohort = 'eligible' AND execution_mode = 'live' AND simulated = 0 AND dry_run = 0
          AND status = 'completed' AND termination_reason = 'success' AND evidence_status = 'complete'
          AND evaluation_status = 'evaluated' AND artifact_integrity_status = 'verified'
          AND required_checks_declared IS NOT NULL AND required_checks_executed IS NOT NULL
          AND required_checks_passed IS NOT NULL AND required_checks_declared > 0
          AND required_checks_executed = required_checks_declared
          AND evaluator_id IS NOT NULL AND length(trim(evaluator_id)) > 0
          AND evaluator_version IS NOT NULL AND length(trim(evaluator_version)) > 0
          AND evidence_digest IS NOT NULL AND length(trim(evidence_digest)) > 0
          AND evidence_identity_json IS NOT NULL AND evaluation_json IS NOT NULL
          AND composite_score IS NOT NULL AND composite_score >= 0 AND composite_score <= 100
          AND passed_benchmark IS NOT NULL AND passed_benchmark IN (0, 1))
      ),
      CHECK((eligibility_status = 'eligible' AND benchmark_cohort = 'eligible') OR (eligibility_status != 'eligible' AND benchmark_cohort != 'eligible')),
      CHECK(eligibility_status = 'eligible' OR evaluation_status != 'evaluated'),
      CHECK(eligibility_status = 'eligible' OR (composite_score IS NULL AND passed_benchmark IS NULL AND actual_cost_usd IS NULL)),
      CHECK(benchmark_cohort != 'validation' OR execution_mode = 'fake' OR simulated = 1 OR dry_run = 1),
      CHECK(cost_evidence_status != 'simulated_zero' OR (operational_cost_usd = 0 AND actual_cost_usd IS NULL)),
      CHECK(cost_evidence_status != 'unverified' OR actual_cost_usd IS NULL),
      CHECK(cost_evidence_status != 'verified' OR (eligibility_status = 'eligible' AND actual_cost_usd IS NOT NULL AND actual_cost_usd >= 0
        AND cost_pricing_identity IS NOT NULL AND length(trim(cost_pricing_identity)) > 0
        AND cost_usage_digest IS NOT NULL AND length(trim(cost_usage_digest)) > 0))
    );
  `);
  createRunIndexes(database);
}

function migrateLegacyRuns(database: Database): void {
  dropRunIndexes(database);
  database.exec("ALTER TABLE runs RENAME TO legacy_runs;");
  createAuthoritySchema(database);
  database.exec(`
    INSERT INTO runs (
      run_id, sweep_id, plan_fingerprint, cell_id, matrix_occurrence_index,
      scenario_id, category, skill_id, skill_version, model_id, provider_id,
      execution_mode, simulated, dry_run, thinking_level, thinking_budget_tokens,
      reasoning_tokens, status, termination_reason, benchmark_cohort, eligibility_status,
      eligibility_reasons_json, evidence_status, evaluation_status, artifact_integrity_status,
      operational_cost_usd, cost_evidence_status, wall_clock_ms, total_tokens, cache_hit_ratio,
      total_turns, error_count, attempt_count, started_at, completed_at, commit_sha
    )
    SELECT
      run_id, sweep_id, plan_fingerprint, cell_id, matrix_occurrence_index,
      scenario_id, category, skill_id, skill_version, model_id, provider_id,
      execution_mode, simulated, 0, thinking_level, thinking_budget_tokens,
      reasoning_tokens, status, termination_reason, 'operational', 'unknown',
      '["evidence_invalid"]', 'unavailable', 'not_evaluated', 'unverified',
      CASE WHEN total_cost_usd >= 0 THEN total_cost_usd ELSE 0 END, 'unverified',
      CASE WHEN wall_clock_ms >= 0 THEN wall_clock_ms ELSE 0 END,
      CASE WHEN total_tokens >= 0 THEN total_tokens ELSE 0 END,
      CASE WHEN cache_hit_ratio >= 0 AND cache_hit_ratio <= 1 THEN cache_hit_ratio ELSE 0 END,
      CASE WHEN total_turns >= 0 THEN total_turns ELSE 0 END,
      CASE WHEN error_count >= 0 THEN error_count ELSE 0 END,
      CASE WHEN attempt_count >= 0 THEN attempt_count ELSE 0 END,
      started_at, completed_at, commit_sha
    FROM legacy_runs;
    DROP TABLE legacy_runs;
  `);
}

function createSupportingSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS run_claims (
      run_id TEXT PRIMARY KEY, sweep_id TEXT NOT NULL, cell_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telemetry_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, scenario_id TEXT NOT NULL,
      skill_id TEXT, model_id TEXT NOT NULL, timestamp_us TEXT NOT NULL,
      event_type TEXT NOT NULL, sequence_number INTEGER, payload_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_telemetry_run_id ON telemetry_events(run_id);
    CREATE INDEX IF NOT EXISTS idx_telemetry_event_type ON telemetry_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry_events(timestamp_us);
  `);
}

function migrateVersionTwoSchema(database: Database): void {
  assertExactColumns(readColumns(database, "runs"), authorityRunColumns);
  assertExactColumns(readColumns(database, "run_claims"), runClaimColumns);
  assertExactColumns(readColumns(database, "telemetry_events"), telemetryColumns);
  assertExactColumns(readColumns(database, "elo_ratings"), retiredEloColumns);
  database.transaction(() => {
    database.exec("DROP INDEX IF EXISTS idx_elo_rating; DROP TABLE elo_ratings;");
    database.exec(`PRAGMA user_version = ${reportingSchemaVersion};`);
  })();
}

function createRunIndexes(database: Database): void {
  database.exec(`
    CREATE INDEX idx_runs_scenario_id ON runs(scenario_id);
    CREATE INDEX idx_runs_skill_id ON runs(skill_id);
    CREATE INDEX idx_runs_model_id ON runs(model_id);
    CREATE INDEX idx_runs_provider_id ON runs(provider_id);
    CREATE INDEX idx_runs_category ON runs(category);
    CREATE INDEX idx_runs_status ON runs(status);
    CREATE INDEX idx_runs_eligibility ON runs(eligibility_status);
    CREATE INDEX idx_runs_started_at ON runs(started_at);
    CREATE INDEX idx_runs_completed_at ON runs(completed_at);
    CREATE INDEX idx_runs_skill_completed ON runs(skill_id, completed_at);
  `);
}

function dropRunIndexes(database: Database): void {
  database.exec(`
    DROP INDEX IF EXISTS idx_runs_scenario_id;
    DROP INDEX IF EXISTS idx_runs_skill_id;
    DROP INDEX IF EXISTS idx_runs_model_id;
    DROP INDEX IF EXISTS idx_runs_provider_id;
    DROP INDEX IF EXISTS idx_runs_category;
    DROP INDEX IF EXISTS idx_runs_status;
    DROP INDEX IF EXISTS idx_runs_started_at;
    DROP INDEX IF EXISTS idx_runs_completed_at;
    DROP INDEX IF EXISTS idx_runs_skill_completed;
  `);
}

function readUserVersion(database: Database): number {
  const row = database.query("PRAGMA user_version").get() as { readonly user_version: number } | null;
  return row?.user_version ?? 0;
}

function readColumns(database: Database, table: string): readonly string[] {
  const exists = database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (exists === null) return [];
  return (database.query(`PRAGMA table_info(${table})`).all() as { readonly name: string }[]).map((row) => row.name);
}

function assertExactColumns(actual: readonly string[], expected: ReadonlySet<string>): void {
  if (actual.length !== expected.size || actual.some((column) => !expected.has(column))) {
    throw new TypeError("Unknown benchmark database schema shape");
  }
}

function assertExistingSupportingSchema(database: Database): void {
  const expectedTables: readonly [string, ReadonlySet<string>][] = [
    ["run_claims", runClaimColumns],
    ["telemetry_events", telemetryColumns],
    ["elo_ratings", retiredEloColumns],
  ];
  for (const [table, expected] of expectedTables) {
    const columns = readColumns(database, table);
    if (columns.length > 0) assertExactColumns(columns, expected);
  }
}

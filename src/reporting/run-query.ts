import { isEligibleRunRecord } from "../shared/benchmark-authority.js";
import { normalizeReportFilter, recordMatchesReportFilter } from "./report-cohorts.js";
import type { ReportFilter, RunQueryFilter } from "./report-cohorts.js";
import type { RunRecord } from "./types.js";

export interface PreparedRunQuery {
  readonly sql: string;
  readonly bindings: readonly (string | number)[];
  readonly filter: RunQueryFilter;
}

const pluralColumns: readonly [keyof ReportFilter, string][] = [
  ["scenarioIds", "scenario_id"],
  ["categories", "category"],
  ["skillIds", "skill_id"],
  ["modelIds", "model_id"],
  ["providerIds", "provider_id"],
  ["statuses", "status"],
  ["executionModes", "execution_mode"],
  ["benchmarkCohorts", "benchmark_cohort"],
  ["eligibilityStatuses", "eligibility_status"],
  ["evaluationStatuses", "evaluation_status"],
  ["evidenceStatuses", "evidence_status"],
];

export function normalizeRunQueryFilter(input: RunQueryFilter = {}): RunQueryFilter {
  const report = normalizeReportFilter(input);
  const passedBenchmark = normalizeBoolean(input.passedBenchmark, "passedBenchmark");
  const minScore = normalizeScore(input.minScore, "minScore");
  const maxScore = normalizeScore(input.maxScore, "maxScore");
  const limit = normalizeInteger(input.limit, "limit", 1, 1000);
  const offset = normalizeInteger(input.offset, "offset", 0, Number.MAX_SAFE_INTEGER);
  if (minScore !== undefined && maxScore !== undefined && minScore > maxScore) throw new TypeError("Run score range is invalid");
  return Object.freeze({
    ...report,
    ...(passedBenchmark === undefined ? {} : { passedBenchmark }),
    ...(minScore === undefined ? {} : { minScore }),
    ...(maxScore === undefined ? {} : { maxScore }),
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
  });
}

export function createPreparedRunQuery(input: RunQueryFilter = {}, count = false): PreparedRunQuery {
  const filter = normalizeRunQueryFilter(input);
  const clauses: string[] = [];
  const bindings: (string | number)[] = [];
  for (const [key, column] of pluralColumns) addArrayClause(clauses, bindings, column, filter[key] as readonly string[] | undefined);
  addExactClause(clauses, bindings, "simulated", filter.simulated === undefined ? undefined : filter.simulated ? 1 : 0);
  if (filter.authority === "eligible") clauses.push("eligibility_status = 'eligible'");
  if (filter.authority === "diagnostic") clauses.push("eligibility_status != 'eligible'");
  if (filter.fromDate !== undefined) addComparisonClause(clauses, bindings, "started_at", ">=", filter.fromDate);
  if (filter.toDate !== undefined) addComparisonClause(clauses, bindings, "started_at", "<=", filter.toDate);
  if (filter.passedBenchmark !== undefined || filter.minScore !== undefined || filter.maxScore !== undefined) {
    clauses.push("eligibility_status = 'eligible'");
  }
  addExactClause(clauses, bindings, "passed_benchmark", filter.passedBenchmark === undefined ? undefined : filter.passedBenchmark ? 1 : 0);
  if (filter.minScore !== undefined) addComparisonClause(clauses, bindings, "composite_score", ">=", filter.minScore);
  if (filter.maxScore !== undefined) addComparisonClause(clauses, bindings, "composite_score", "<=", filter.maxScore);
  const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
  if (count) return { sql: `SELECT COUNT(*) AS count FROM runs${where}`, bindings, filter };
  let sql = `SELECT * FROM runs${where} ORDER BY started_at ASC, run_id ASC`;
  if (filter.limit !== undefined) {
    sql += " LIMIT ?";
    bindings.push(filter.limit);
  } else if (filter.offset !== undefined) {
    sql += " LIMIT -1";
  }
  if (filter.offset !== undefined) {
    sql += " OFFSET ?";
    bindings.push(filter.offset);
  }
  return { sql, bindings, filter };
}

export function recordMatchesRunQuery(record: RunRecord, filter: RunQueryFilter): boolean {
  if (!recordMatchesReportFilter(record, filter)) return false;
  if (filter.passedBenchmark !== undefined && (!isEligibleRunRecord(record) || record.passedBenchmark !== filter.passedBenchmark)) return false;
  if (filter.minScore !== undefined && (!isEligibleRunRecord(record) || record.compositeScore < filter.minScore)) return false;
  if (filter.maxScore !== undefined && (!isEligibleRunRecord(record) || record.compositeScore > filter.maxScore)) return false;
  return true;
}

function addArrayClause(
  clauses: string[],
  bindings: (string | number)[],
  column: string,
  values: readonly string[] | undefined
): void {
  if (values === undefined) return;
  if (values.length === 0) {
    clauses.push("0");
    return;
  }
  clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
  bindings.push(...values);
}

function addExactClause(clauses: string[], bindings: (string | number)[], column: string, value: string | number | undefined): void {
  if (value === undefined) return;
  clauses.push(`${column} = ?`);
  bindings.push(value);
}

function addComparisonClause(clauses: string[], bindings: (string | number)[], column: string, operator: string, value: string | number): void {
  clauses.push(`${column} ${operator} ?`);
  bindings.push(value);
}

function normalizeBoolean(value: boolean | undefined, key: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`Run ${key} must be boolean`);
  return value;
}

function normalizeScore(value: number | undefined, key: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new TypeError(`Run ${key} is invalid`);
  return value;
}

function normalizeInteger(value: number | undefined, key: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`Run ${key} is invalid`);
  return value;
}

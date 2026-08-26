import type { Database } from "bun:sqlite";
import { assertBenchmarkAuthority, isEligibleRunRecord } from "../shared/benchmark-authority.js";
import type {
  EligibleRunRecord,
  RunManifest,
  RunMetricsSummary,
  RunRecord,
  RunStatus,
} from "./types.js";
import type { ExecutionMode } from "../shared/execution-mode.js";
import type { RunQueryFilter } from "./report-cohorts.js";
import { createPreparedRunQuery, recordMatchesRunQuery } from "./run-query.js";

interface RunRow {
  readonly [key: string]: unknown;
  readonly run_id: string;
  readonly scenario_id: string;
  readonly category: string;
  readonly skill_id: string;
  readonly model_id: string;
  readonly provider_id: string;
  readonly execution_mode: ExecutionMode;
  readonly simulated: number;
  readonly dry_run: number;
  readonly status: RunStatus;
  readonly benchmark_cohort: RunRecord["benchmarkCohort"];
  readonly eligibility_status: RunRecord["eligibility"]["status"];
  readonly eligibility_reasons_json: string;
  readonly evidence_status: RunRecord["evidence"]["status"];
  readonly evaluation_status: RunRecord["evaluation"]["status"];
  readonly required_checks_declared: number | null;
  readonly required_checks_executed: number | null;
  readonly required_checks_passed: number | null;
  readonly artifact_integrity_status: RunRecord["evidence"]["artifactIntegrity"];
  readonly evaluator_id: string | null;
  readonly evaluator_version: string | null;
  readonly evidence_digest: string | null;
  readonly evidence_identity_json: string | null;
  readonly composite_score: number | null;
  readonly passed_benchmark: number | null;
  readonly operational_cost_usd: number;
  readonly cost_evidence_status: RunRecord["operationalCost"]["status"];
  readonly actual_cost_usd: number | null;
  readonly cost_pricing_identity: string | null;
  readonly cost_usage_digest: string | null;
  readonly wall_clock_ms: number;
  readonly total_tokens: number;
  readonly cache_hit_ratio: number;
  readonly total_turns: number;
  readonly error_count: number;
  readonly attempt_count: number;
  readonly started_at: string;
  readonly completed_at: string;
  readonly evaluation_json: string | null;
}

export class ReportingQueryStore {
  public constructor(private readonly database: Database) {}

  public getRunRecord(runId: string): RunRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM runs WHERE run_id = ?")
      .get(runId) as RunRow | null;
    return row === null ? undefined : mapRowToRunRecord(row);
  }

  public queryRuns(filter?: RunQueryFilter): readonly RunRecord[] {
    const prepared = createPreparedRunQuery(filter);
    const records = (this.database.prepare(prepared.sql).all(...prepared.bindings) as RunRow[]).map(
      mapRowToRunRecord,
    );
    if (records.some((record) => !recordMatchesRunQuery(record, prepared.filter))) {
      throw new TypeError("Run query returned a record outside its filter");
    }
    return records;
  }

  public countRuns(filter?: RunQueryFilter): number {
    const prepared = createPreparedRunQuery(filter, true);
    const row = this.database.prepare(prepared.sql).get(...prepared.bindings) as {
      readonly count: number;
    } | null;
    if (row === null || !Number.isSafeInteger(row.count) || row.count < 0)
      throw new TypeError("Run count query failed");
    return row.count;
  }

  public queryEligibleRuns(filter?: RunQueryFilter): readonly EligibleRunRecord[] {
    const records = this.queryRuns({ ...filter, authority: "eligible" });
    if (!records.every(isEligibleRunRecord))
      throw new TypeError("Eligible run query returned contradictory evidence");
    return records;
  }
}

function mapRowToRunRecord(row: RunRow): RunRecord {
  const reasons =
    parseJson<RunRecord["eligibility"]["reasons"]>(row.eligibility_reasons_json) ?? [];
  const identity = parseJson<NonNullable<RunRecord["evidence"]["identity"]>>(
    row.evidence_identity_json,
  );
  const evidence = {
    status: row.evidence_status,
    requiredChecksDeclared: row.required_checks_declared ?? 0,
    requiredChecksExecuted: row.required_checks_executed ?? 0,
    requiredChecksPassed: row.required_checks_passed ?? 0,
    artifactIntegrity: row.artifact_integrity_status,
    ...(row.evaluator_id === null ? {} : { evaluatorId: row.evaluator_id }),
    ...(row.evaluator_version === null ? {} : { evaluatorVersion: row.evaluator_version }),
    ...(row.evidence_digest === null ? {} : { evidenceDigest: row.evidence_digest }),
    ...(identity === undefined ? {} : { identity }),
  } as RunRecord["evidence"];
  const evaluation = parseJson<RunRecord["evaluation"]>(row.evaluation_json) ?? {
    status: "not_evaluated",
    reasons,
  };
  const common = mapCommonFields(row);
  if (row.eligibility_status === "eligible") {
    if (
      row.composite_score === null ||
      row.passed_benchmark === null ||
      evaluation.status !== "evaluated" ||
      evidence.status !== "complete"
    ) {
      throw new TypeError("Eligible database row is incomplete");
    }
    const operationalCost =
      row.cost_evidence_status === "verified"
        ? {
            status: "verified" as const,
            amountUSD: row.operational_cost_usd,
            pricingIdentity: row.cost_pricing_identity ?? "",
            usageDigest: row.cost_usage_digest ?? "",
          }
        : { status: "unverified" as const, amountUSD: row.operational_cost_usd };
    return validateMappedRecord({
      ...common,
      benchmarkCohort: "eligible",
      eligibility: { status: "eligible", reasons: [] },
      evidence,
      evaluation,
      operationalCost,
      compositeScore: row.composite_score,
      passedBenchmark: row.passed_benchmark === 1,
      ...(row.actual_cost_usd === null ? {} : { actualCostUSD: row.actual_cost_usd }),
    } as EligibleRunRecord);
  }
  const operationalCost =
    row.cost_evidence_status === "simulated_zero"
      ? { status: "simulated_zero" as const, amountUSD: 0 as const }
      : { status: "unverified" as const, amountUSD: row.operational_cost_usd };
  return validateMappedRecord({
    ...common,
    benchmarkCohort: row.benchmark_cohort === "validation" ? "validation" : "operational",
    eligibility: { status: row.eligibility_status, reasons },
    evidence,
    evaluation: evaluation.status === "evaluated" ? { status: "invalid", reasons } : evaluation,
    operationalCost,
  } as RunRecord);
}

function validateMappedRecord(record: RunRecord): RunRecord {
  assertBenchmarkAuthority(record);
  if (isEligibleRunRecord(record)) {
    const identity = record.evidence.identity;
    if (
      identity.runId !== record.runId ||
      identity.scenarioId !== record.scenarioId ||
      identity.skillId !== record.skillId ||
      identity.modelId !== record.modelId ||
      identity.providerId !== record.providerId
    )
      throw new TypeError("Eligible database row has contradictory identity");
  }
  return record;
}

function mapCommonFields(row: RunRow) {
  const manifest = parseJson<RunManifest>(nullableString(row.manifest_json));
  const metrics = parseJson<RunMetricsSummary>(nullableString(row.metrics_json));
  return {
    ...optionalString(row, "sweep_id", "sweepId"),
    ...optionalString(row, "plan_fingerprint", "planFingerprint"),
    ...optionalString(row, "cell_id", "cellId"),
    ...(typeof row.matrix_occurrence_index === "number"
      ? { matrixOccurrenceIndex: row.matrix_occurrence_index }
      : {}),
    runId: row.run_id,
    scenarioId: row.scenario_id,
    category: row.category,
    skillId: row.skill_id,
    ...optionalString(row, "skill_version", "skillVersion"),
    modelId: row.model_id,
    providerId: row.provider_id,
    executionMode: row.execution_mode,
    simulated: row.simulated === 1,
    dryRun: row.dry_run === 1,
    ...optionalString(row, "thinking_level", "thinkingLevel"),
    ...(typeof row.thinking_budget_tokens === "number"
      ? { thinkingBudgetTokens: row.thinking_budget_tokens }
      : {}),
    ...(typeof row.reasoning_tokens === "number" ? { reasoningTokens: row.reasoning_tokens } : {}),
    status: row.status,
    ...optionalString(row, "termination_reason", "terminationReason"),
    wallClockMs: row.wall_clock_ms,
    totalTokens: row.total_tokens,
    cacheHitRatio: row.cache_hit_ratio,
    totalTurns: row.total_turns,
    errorCount: row.error_count,
    attemptCount: row.attempt_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    ...(manifest === undefined ? {} : { manifest }),
    ...(metrics === undefined ? {} : { metrics }),
  };
}

function parseJson<T>(raw: string | null): T | undefined {
  return raw && raw !== "" ? (JSON.parse(raw) as T) : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalString(
  row: RunRow,
  databaseKey: string,
  publicKey: string,
): Record<string, string> {
  const value = row[databaseKey];
  return typeof value === "string" ? { [publicKey]: value } : {};
}

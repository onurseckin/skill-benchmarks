import type { Database } from "bun:sqlite";
import { isDeepStrictEqual } from "node:util";
import {
  assertBenchmarkAuthority,
  classifyBenchmarkAuthority,
  isEligibleRunRecord,
  type BenchmarkAuthority,
} from "../shared/benchmark-authority.js";
import { sanitizeBenchmarkArtifactValue } from "../shared/artifact-sanitization.js";
import { claimTerminalRunIdentity, TerminalRunIdentityConflictError } from "./run-identity.js";
import { TelemetryArtifactSanitizer } from "./telemetry-artifact-sanitizer.js";
import type { RunRecord, TelemetryEventRecord } from "./types.js";

export class ReportingRunStore {
  private readonly telemetrySanitizer = new TelemetryArtifactSanitizer();

  public constructor(private readonly database: Database) {}

  public saveRunRecord(record: RunRecord): void {
    assertRunRecordAuthority(record);
    const sanitizedRecord = sanitizeBenchmarkArtifactValue(record) as RunRecord;
    assertRunRecordAuthority(sanitizedRecord);
    const authority: BenchmarkAuthority = sanitizedRecord;
    const eligibleRecord = isEligibleRunRecord(sanitizedRecord) ? sanitizedRecord : undefined;
    const evidence = authority.evidence;
    const cost = authority.operationalCost;
    const skillVersion = sanitizedRecord.skillVersion ?? sanitizedRecord.manifest?.skillVersion ?? null;
    const commitSha = sanitizedRecord.manifest?.environment?.hostCommitSha ?? null;
    const manifestJson = sanitizedRecord.manifest ? JSON.stringify(sanitizedRecord.manifest) : null;
    const metricsJson = sanitizedRecord.metrics ? JSON.stringify(sanitizedRecord.metrics) : null;
    const evaluationJson = JSON.stringify(authority.evaluation);
    const statement = this.database.prepare(`
      INSERT INTO runs (
        run_id, sweep_id, plan_fingerprint, cell_id, matrix_occurrence_index,
        scenario_id, category, skill_id, skill_version, model_id, provider_id,
        execution_mode, simulated, dry_run, thinking_level, thinking_budget_tokens,
        reasoning_tokens, status, termination_reason, benchmark_cohort, eligibility_status,
        eligibility_reasons_json, evidence_status, evaluation_status, required_checks_declared,
        required_checks_executed, required_checks_passed, artifact_integrity_status,
        evaluator_id, evaluator_version, evidence_digest, evidence_identity_json,
        composite_score, passed_benchmark, operational_cost_usd, cost_evidence_status,
        actual_cost_usd, cost_pricing_identity, cost_usage_digest, wall_clock_ms,
        total_tokens, cache_hit_ratio, total_turns, error_count, attempt_count,
        started_at, completed_at, manifest_json, metrics_json, evaluation_json, commit_sha
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    try {
      statement.run(
        sanitizedRecord.runId,
        sanitizedRecord.sweepId ?? null,
        sanitizedRecord.planFingerprint ?? null,
        sanitizedRecord.cellId ?? null,
        sanitizedRecord.matrixOccurrenceIndex ?? null,
        sanitizedRecord.scenarioId,
        sanitizedRecord.category,
        sanitizedRecord.skillId,
        skillVersion,
        sanitizedRecord.modelId,
        sanitizedRecord.providerId,
        sanitizedRecord.executionMode,
        sanitizedRecord.simulated ? 1 : 0,
        sanitizedRecord.dryRun ? 1 : 0,
        sanitizedRecord.thinkingLevel ?? sanitizedRecord.manifest?.modelParameters?.thinkingLevel ?? null,
        sanitizedRecord.thinkingBudgetTokens ?? sanitizedRecord.manifest?.modelParameters?.thinkingBudgetTokens ?? null,
        sanitizedRecord.reasoningTokens ?? null,
        sanitizedRecord.status,
        sanitizedRecord.terminationReason ?? null,
        authority.benchmarkCohort,
        authority.eligibility.status,
        JSON.stringify(authority.eligibility.reasons),
        evidence.status,
        authority.evaluation.status,
        evidence.requiredChecksDeclared,
        evidence.requiredChecksExecuted,
        evidence.requiredChecksPassed,
        evidence.artifactIntegrity,
        evidence.evaluatorId ?? null,
        evidence.evaluatorVersion ?? null,
        evidence.evidenceDigest ?? null,
        evidence.identity ? JSON.stringify(evidence.identity) : null,
        eligibleRecord?.compositeScore ?? null,
        eligibleRecord === undefined ? null : (eligibleRecord.passedBenchmark ? 1 : 0),
        cost.amountUSD,
        cost.status,
        eligibleRecord?.actualCostUSD ?? null,
        cost.status === "verified" ? cost.pricingIdentity : null,
        cost.status === "verified" ? cost.usageDigest : null,
        sanitizedRecord.wallClockMs,
        sanitizedRecord.totalTokens,
        sanitizedRecord.cacheHitRatio,
        sanitizedRecord.totalTurns,
        sanitizedRecord.errorCount,
        sanitizedRecord.attemptCount ?? 0,
        sanitizedRecord.startedAt,
        sanitizedRecord.completedAt,
        manifestJson,
        metricsJson,
        evaluationJson,
        commitSha
      );
      this.database.prepare("DELETE FROM run_claims WHERE run_id = ?").run(record.runId);
    } catch (error) {
      const existing = this.database.prepare("SELECT 1 FROM runs WHERE run_id = ?").get(record.runId);
      if (existing !== null) throw new TerminalRunIdentityConflictError();
      throw error;
    }
  }

  public saveRunRecordWithArtifact(record: RunRecord, commitArtifact: () => void): void {
    this.database.transaction(() => {
      this.saveRunRecord(record);
      commitArtifact();
    })();
  }

  public claimRunIdentity(runId: string, sweepId: string, cellId: string): void {
    claimTerminalRunIdentity(this.database, runId, sweepId, cellId);
  }

  public saveTelemetryEvents(events: ReadonlyArray<TelemetryEventRecord>): void {
    if (events.length === 0) return;
    const statement = this.database.prepare(`
      INSERT INTO telemetry_events (
        run_id, scenario_id, skill_id, model_id, timestamp_us, event_type, sequence_number, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.database.transaction((records: ReadonlyArray<TelemetryEventRecord>) => {
      for (const event of records) {
        const sanitized = this.telemetrySanitizer.sanitize(event) as TelemetryEventRecord;
        statement.run(
          sanitized.runId,
          sanitized.scenarioId,
          sanitized.skillId ?? null,
          sanitized.modelId,
          sanitized.timestampUs,
          sanitized.eventType,
          sanitized.sequenceNumber ?? null,
          sanitized.payload ? JSON.stringify(sanitized.payload) : null
        );
      }
    })(events);
  }
}

function assertRunRecordAuthority(record: RunRecord): void {
  assertBenchmarkAuthority(record);
  if (record.eligibility.status === "unknown") throw new TypeError("Unknown evidence cannot be newly persisted");
  const expectedIdentity = {
    runId: record.runId,
    scenarioId: record.scenarioId,
    skillId: record.skillId,
    modelId: record.modelId,
    providerId: record.providerId,
    workspaceFingerprint: record.evidence.identity?.workspaceFingerprint ?? "",
  };
  const classified = classifyBenchmarkAuthority({
    executionMode: record.executionMode,
    simulated: record.simulated,
    dryRun: record.dryRun,
    lifecycleStatus: record.status,
    terminationReason: record.terminationReason,
    expectedIdentity,
    evidence: record.evidence,
    evaluation: record.evaluation,
    operationalCost: record.operationalCost,
  });
  const recordAuthority = authorityProjection(record);
  if (!isDeepStrictEqual(classified, recordAuthority)) throw new TypeError("Run record does not match benchmark authority");
}

function authorityProjection(record: RunRecord): BenchmarkAuthority {
  if (isEligibleRunRecord(record)) {
    return {
      benchmarkCohort: record.benchmarkCohort,
      eligibility: record.eligibility,
      evidence: record.evidence,
      evaluation: record.evaluation,
      operationalCost: record.operationalCost,
      compositeScore: record.compositeScore,
      passedBenchmark: record.passedBenchmark,
      ...(record.actualCostUSD === undefined ? {} : { actualCostUSD: record.actualCostUSD }),
    };
  }
  return {
    benchmarkCohort: record.benchmarkCohort,
    eligibility: record.eligibility,
    evidence: record.evidence,
    evaluation: record.evaluation,
    operationalCost: record.operationalCost,
  };
}

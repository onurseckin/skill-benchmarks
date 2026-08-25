import { assertBenchmarkAuthority, benchmarkReasonOrder, isEligibleRunRecord } from "../shared/benchmark-authority.js";
import type {
  BenchmarkCohort,
  BenchmarkEligibilityStatus,
  BenchmarkIneligibilityReason,
  EvaluationOutcomeStatus,
  EvidenceStateStatus,
} from "../shared/benchmark-authority.js";
import type { ExecutionMode } from "../shared/execution-mode.js";
import { buildReportClaims } from "./aggregator.js";
import type { ObservedStatistics } from "./report-statistics.js";
import type { RunRecord, RunStatus } from "./types.js";

export type ReportAuthority = "eligible" | "diagnostic";

export interface ReportFilter {
  readonly scenarioIds?: readonly string[];
  readonly categories?: readonly string[];
  readonly skillIds?: readonly string[];
  readonly modelIds?: readonly string[];
  readonly providerIds?: readonly string[];
  readonly statuses?: readonly RunStatus[];
  readonly executionModes?: readonly ExecutionMode[];
  readonly simulated?: boolean;
  readonly authority?: ReportAuthority;
  readonly benchmarkCohorts?: readonly BenchmarkCohort[];
  readonly eligibilityStatuses?: readonly BenchmarkEligibilityStatus[];
  readonly evaluationStatuses?: readonly EvaluationOutcomeStatus[];
  readonly evidenceStatuses?: readonly EvidenceStateStatus[];
  readonly fromDate?: string;
  readonly toDate?: string;
}

export interface RunQueryFilter extends ReportFilter {
  readonly passedBenchmark?: boolean;
  readonly minScore?: number;
  readonly maxScore?: number;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ReportSampleMean {
  readonly mean: number;
  readonly sampleCount: number;
}

export interface ReportLeaderboardEntry {
  readonly rank: number;
  readonly category: string;
  readonly skillId: string;
  readonly scenarioIds: readonly string[];
  readonly modelIds: readonly string[];
  readonly providerIds: readonly string[];
  readonly eligibleRunCount: number;
  readonly passCount: number;
  readonly failedBenchmarkCount: number;
  readonly passRate: number;
  readonly passRateConfidence95: readonly [number, number];
  readonly score: ObservedStatistics;
  readonly duration: ReportSampleMean;
  readonly cacheHitRatio?: ReportSampleMean;
  readonly verifiedActualCost?: ReportSampleMean;
}

export interface ReportCategoryLeaderboard {
  readonly category: string;
  readonly entries: readonly ReportLeaderboardEntry[];
  readonly totalEligibleRuns: number;
  readonly topSkillId?: string;
}

export interface ReportTrendPoint {
  readonly date: string;
  readonly eligibleRunCount: number;
  readonly passCount: number;
  readonly passRate: number;
  readonly score: ReportSampleMean;
  readonly duration: ReportSampleMean;
  readonly verifiedActualCost?: ReportSampleMean;
}

export interface ReportCostPoint {
  readonly category: string;
  readonly skillId: string;
  readonly modelId: string;
  readonly averageVerifiedActualCostUSD: number;
  readonly averageScore: number;
  readonly passRate: number;
  readonly sampleCount: number;
}

export interface ReportLatencyPercentiles {
  readonly method: "nearest_rank";
  readonly sampleCount: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p99Ms: number;
}

export interface ReportVelocityPoint {
  readonly category: string;
  readonly skillId: string;
  readonly modelId: string;
  readonly meanTokensPerSecond: number;
  readonly sampleCount: number;
}

export interface ReportProvenanceFacts {
  readonly executionModeCounts: Readonly<Record<ExecutionMode, number>>;
  readonly simulatedRunCount: number;
  readonly nonSimulatedRunCount: number;
  readonly cohortCounts: Readonly<Record<BenchmarkCohort, number>>;
  readonly eligibilityCounts: Readonly<Record<BenchmarkEligibilityStatus, number>>;
  readonly evaluationStatusCounts: Readonly<Record<EvaluationOutcomeStatus, number>>;
  readonly evidenceStatusCounts: Readonly<Record<EvidenceStateStatus, number>>;
  readonly lifecycleStatusCounts: Readonly<Record<RunStatus, number>>;
  readonly eligibilityReasonCounts: readonly { readonly reason: BenchmarkIneligibilityReason; readonly count: number }[];
  readonly evidenceThrough?: string;
}

export interface ReportSnapshot {
  readonly schemaVersion: "1.0.0";
  readonly generatedAt: string;
  readonly filter: ReportFilter;
  readonly matchedRunCount: number;
  readonly eligibleRunCount: number;
  readonly diagnosticRunCount: number;
  readonly provenance: ReportProvenanceFacts;
  readonly leaderboard: readonly ReportLeaderboardEntry[];
  readonly categoryLeaderboards: readonly ReportCategoryLeaderboard[];
  readonly trends?: readonly ReportTrendPoint[];
  readonly costEfficiency?: readonly ReportCostPoint[];
  readonly latencyPercentiles?: ReportLatencyPercentiles;
  readonly tokenVelocity?: readonly ReportVelocityPoint[];
}

export interface ReportBuildOptions {
  readonly generatedAt?: string;
  readonly includeTrends?: boolean;
  readonly includeCostEfficiency?: boolean;
}

const runStatuses: readonly RunStatus[] = ["completed", "failed", "timed_out", "aborted"];
const executionModes: readonly ExecutionMode[] = ["fake", "live"];
const authorities: readonly ReportAuthority[] = ["eligible", "diagnostic"];
const cohorts: readonly BenchmarkCohort[] = ["eligible", "validation", "operational"];
const eligibilities: readonly BenchmarkEligibilityStatus[] = ["eligible", "ineligible", "unknown"];
const evaluations: readonly EvaluationOutcomeStatus[] = ["not_requested", "not_evaluated", "evaluated", "invalid"];
const evidenceStates: readonly EvidenceStateStatus[] = ["unavailable", "collecting", "complete", "invalid"];

export function normalizeReportFilter(input: ReportFilter = {}): ReportFilter {
  const normalized: ReportFilter = {
    ...normalizeTextArray(input.scenarioIds, "scenarioIds"),
    ...normalizeTextArray(input.categories, "categories"),
    ...normalizeTextArray(input.skillIds, "skillIds"),
    ...normalizeTextArray(input.modelIds, "modelIds"),
    ...normalizeTextArray(input.providerIds, "providerIds"),
    ...normalizeEnumArray(input.statuses, "statuses", runStatuses),
    ...normalizeEnumArray(input.executionModes, "executionModes", executionModes),
    ...(input.simulated === undefined ? {} : { simulated: requireBoolean(input.simulated, "simulated") }),
    ...(input.authority === undefined ? {} : { authority: requireEnum(input.authority, "authority", authorities) }),
    ...normalizeEnumArray(input.benchmarkCohorts, "benchmarkCohorts", cohorts),
    ...normalizeEnumArray(input.eligibilityStatuses, "eligibilityStatuses", eligibilities),
    ...normalizeEnumArray(input.evaluationStatuses, "evaluationStatuses", evaluations),
    ...normalizeEnumArray(input.evidenceStatuses, "evidenceStatuses", evidenceStates),
    ...normalizeDate(input.fromDate, "fromDate"),
    ...normalizeDate(input.toDate, "toDate"),
  };
  if (normalized.fromDate !== undefined && normalized.toDate !== undefined && normalized.fromDate > normalized.toDate) {
    throw new TypeError("Report date range is invalid");
  }
  return freezeFilter(normalized);
}

export function buildReportSnapshot(
  matchedRuns: readonly RunRecord[],
  filter: ReportFilter,
  options: ReportBuildOptions = {}
): ReportSnapshot {
  const normalizedFilter = normalizeReportFilter(filter);
  for (const run of matchedRuns) assertBenchmarkAuthority(run);
  if (matchedRuns.some((run) => !recordMatchesReportFilter(run, normalizedFilter))) {
    throw new TypeError("Report query returned a record outside the normalized filter");
  }
  const eligibleRuns = matchedRuns.filter(isEligibleRunRecord);
  const claims = buildReportClaims(eligibleRuns, options);
  const provenance = buildProvenance(matchedRuns);
  const snapshot: ReportSnapshot = {
    schemaVersion: "1.0.0",
    generatedAt: normalizeGeneratedAt(options.generatedAt),
    filter: normalizedFilter,
    matchedRunCount: matchedRuns.length,
    eligibleRunCount: eligibleRuns.length,
    diagnosticRunCount: matchedRuns.length - eligibleRuns.length,
    provenance,
    leaderboard: claims.leaderboard,
    categoryLeaderboards: claims.categoryLeaderboards,
    ...(claims.trends === undefined ? {} : { trends: claims.trends }),
    ...(claims.costEfficiency === undefined ? {} : { costEfficiency: claims.costEfficiency }),
    ...(claims.latencyPercentiles === undefined ? {} : { latencyPercentiles: claims.latencyPercentiles }),
    ...(claims.tokenVelocity === undefined ? {} : { tokenVelocity: claims.tokenVelocity }),
  };
  if (snapshot.leaderboard.reduce((sum, entry) => sum + entry.eligibleRunCount, 0) !== eligibleRuns.length) {
    throw new TypeError("Report leaderboard observation count is contradictory");
  }
  assertProvenanceCounts(snapshot);
  return deepFreeze(snapshot);
}

export function recordMatchesReportFilter(run: RunRecord, filter: ReportFilter): boolean {
  return matchesArray(run.scenarioId, filter.scenarioIds)
    && matchesArray(run.category, filter.categories)
    && matchesArray(run.skillId, filter.skillIds)
    && matchesArray(run.modelId, filter.modelIds)
    && matchesArray(run.providerId, filter.providerIds)
    && matchesArray(run.status, filter.statuses)
    && matchesArray(run.executionMode, filter.executionModes)
    && (filter.simulated === undefined || run.simulated === filter.simulated)
    && (filter.authority === undefined || (filter.authority === "eligible") === isEligibleRunRecord(run))
    && matchesArray(run.benchmarkCohort, filter.benchmarkCohorts)
    && matchesArray(run.eligibility.status, filter.eligibilityStatuses)
    && matchesArray(run.evaluation.status, filter.evaluationStatuses)
    && matchesArray(run.evidence.status, filter.evidenceStatuses)
    && (filter.fromDate === undefined || run.startedAt >= filter.fromDate)
    && (filter.toDate === undefined || run.startedAt <= filter.toDate);
}

function buildProvenance(runs: readonly RunRecord[]): ReportProvenanceFacts {
  const reasonCounts = new Map<BenchmarkIneligibilityReason, number>();
  for (const run of runs) {
    for (const reason of run.eligibility.reasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const evidenceThrough = runs.reduce<string | undefined>((latest, run) => latest === undefined || run.completedAt > latest ? run.completedAt : latest, undefined);
  return deepFreeze({
    executionModeCounts: countValues(runs.map((run) => run.executionMode), executionModes),
    simulatedRunCount: runs.filter((run) => run.simulated).length,
    nonSimulatedRunCount: runs.filter((run) => !run.simulated).length,
    cohortCounts: countValues(runs.map((run) => run.benchmarkCohort), cohorts),
    eligibilityCounts: countValues(runs.map((run) => run.eligibility.status), eligibilities),
    evaluationStatusCounts: countValues(runs.map((run) => run.evaluation.status), evaluations),
    evidenceStatusCounts: countValues(runs.map((run) => run.evidence.status), evidenceStates),
    lifecycleStatusCounts: countValues(runs.map((run) => run.status), runStatuses),
    eligibilityReasonCounts: benchmarkReasonOrder.flatMap((reason) => {
      const count = reasonCounts.get(reason);
      return count === undefined ? [] : [{ reason, count }];
    }),
    ...(evidenceThrough === undefined ? {} : { evidenceThrough }),
  });
}

function assertProvenanceCounts(snapshot: ReportSnapshot): void {
  const expected = snapshot.matchedRunCount;
  const totals = [
    sumCounts(snapshot.provenance.executionModeCounts),
    snapshot.provenance.simulatedRunCount + snapshot.provenance.nonSimulatedRunCount,
    sumCounts(snapshot.provenance.cohortCounts),
    sumCounts(snapshot.provenance.eligibilityCounts),
    sumCounts(snapshot.provenance.evaluationStatusCounts),
    sumCounts(snapshot.provenance.evidenceStatusCounts),
    sumCounts(snapshot.provenance.lifecycleStatusCounts),
  ];
  if (totals.some((total) => total !== expected)) throw new TypeError("Report provenance count is contradictory");
}

function normalizeTextArray(values: readonly string[] | undefined, key: keyof ReportFilter): Partial<ReportFilter> {
  if (values === undefined) return {};
  const normalized = values.map((value) => requireText(value, String(key))).sort();
  requireUnique(normalized, String(key));
  return { [key]: Object.freeze(normalized) } as Partial<ReportFilter>;
}

function normalizeEnumArray<T extends string>(values: readonly T[] | undefined, key: keyof ReportFilter, allowed: readonly T[]): Partial<ReportFilter> {
  if (values === undefined) return {};
  const normalized = values.map((value) => requireEnum(value, String(key), allowed)).sort();
  requireUnique(normalized, String(key));
  return { [key]: Object.freeze(normalized) } as Partial<ReportFilter>;
}

function normalizeDate(value: string | undefined, key: "fromDate" | "toDate"): Partial<ReportFilter> {
  if (value === undefined) return {};
  const normalized = requireText(value, key);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw new TypeError(`Report ${key} is invalid`);
  return { [key]: new Date(timestamp).toISOString() };
}

function normalizeGeneratedAt(value: string | undefined): string {
  const generatedAt = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt))) throw new TypeError("Report generation timestamp is invalid");
  return generatedAt;
}

function requireText(value: string, key: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`Report ${key} contains an empty value`);
  return value.trim();
}

function requireEnum<T extends string>(value: T, key: string, allowed: readonly T[]): T {
  if (!allowed.includes(value)) throw new TypeError(`Report ${key} contains an invalid value`);
  return value;
}

function requireBoolean(value: boolean, key: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`Report ${key} must be boolean`);
  return value;
}

function requireUnique(values: readonly string[], key: string): void {
  if (new Set(values).size !== values.length) throw new TypeError(`Report ${key} contains duplicate values`);
}

function matchesArray<T>(value: T, allowed: readonly T[] | undefined): boolean {
  return allowed === undefined || allowed.includes(value);
}

function countValues<T extends string>(values: readonly T[], allowed: readonly T[]): Readonly<Record<T, number>> {
  return Object.freeze(Object.fromEntries(allowed.map((value) => [value, values.filter((item) => item === value).length]))) as Readonly<Record<T, number>>;
}

function sumCounts(counts: Readonly<Record<string, number>>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function freezeFilter(filter: ReportFilter): ReportFilter {
  return Object.freeze(filter);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

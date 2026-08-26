import type {
  ReportBuildOptions,
  ReportCategoryLeaderboard,
  ReportCostPoint,
  ReportLatencyPercentiles,
  ReportLeaderboardEntry,
  ReportTrendPoint,
  ReportVelocityPoint,
} from "./report-cohorts.js";
import {
  calculateNearestRankPercentile,
  calculateObservedStatistics,
  calculateWilsonInterval,
} from "./report-statistics.js";
import type { EligibleRunRecord } from "./types.js";
import type { VerifiedCostEvidence } from "../shared/benchmark-authority.js";

export interface ReportClaims {
  readonly leaderboard: readonly ReportLeaderboardEntry[];
  readonly categoryLeaderboards: readonly ReportCategoryLeaderboard[];
  readonly trends?: readonly ReportTrendPoint[];
  readonly costEfficiency?: readonly ReportCostPoint[];
  readonly latencyPercentiles?: ReportLatencyPercentiles;
  readonly tokenVelocity?: readonly ReportVelocityPoint[];
}

export function buildReportClaims(
  runs: readonly EligibleRunRecord[],
  options: ReportBuildOptions = {},
): ReportClaims {
  if (runs.length === 0) {
    return Object.freeze({
      leaderboard: Object.freeze([]),
      categoryLeaderboards: Object.freeze([]),
      ...(options.includeTrends ? { trends: Object.freeze([]) } : {}),
      ...(options.includeCostEfficiency ? { costEfficiency: Object.freeze([]) } : {}),
    });
  }
  requireEligibleObservations(runs);
  const leaderboard = buildReportLeaderboard(runs);
  const latencyPercentiles = buildLatencyPercentiles(runs);
  const tokenVelocity = buildTokenVelocity(runs);
  return Object.freeze({
    leaderboard,
    categoryLeaderboards: buildCategoryLeaderboards(leaderboard),
    ...(options.includeTrends ? { trends: buildTrends(runs) } : {}),
    ...(options.includeCostEfficiency ? { costEfficiency: buildCostEfficiency(runs) } : {}),
    latencyPercentiles,
    ...(tokenVelocity.length === 0 ? {} : { tokenVelocity }),
  });
}

export function buildReportLeaderboard(
  runs: readonly EligibleRunRecord[],
): readonly ReportLeaderboardEntry[] {
  const groups = groupRuns(runs, (run) => `${run.category}\u0000${run.skillId}`);
  const unranked = [...groups.values()].map(buildLeaderboardEntry);
  unranked.sort(compareLeaderboardEntries);
  return Object.freeze(
    unranked.map((entry, index) => Object.freeze({ ...entry, rank: index + 1 })),
  );
}

function buildLeaderboardEntry(
  runs: readonly EligibleRunRecord[],
): Omit<ReportLeaderboardEntry, "rank"> {
  const first = requireFirst(runs);
  if (runs.some((run) => run.category !== first.category || run.skillId !== first.skillId)) {
    throw new TypeError("Report leaderboard group identity is contradictory");
  }
  const passCount = runs.filter((run) => run.passedBenchmark).length;
  const scores = calculateObservedStatistics(runs.map((run) => run.compositeScore));
  const cacheSamples = runs
    .map((run) => run.cacheHitRatio)
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  const verifiedCostSamples = verifiedCosts(runs);
  return Object.freeze({
    category: first.category,
    skillId: first.skillId,
    scenarioIds: uniqueSorted(runs.map((run) => run.scenarioId)),
    modelIds: uniqueSorted(runs.map((run) => run.modelId)),
    providerIds: uniqueSorted(runs.map((run) => run.providerId)),
    eligibleRunCount: runs.length,
    passCount,
    failedBenchmarkCount: runs.length - passCount,
    passRate: (passCount / runs.length) * 100,
    passRateConfidence95: calculateWilsonInterval(passCount, runs.length),
    score: scores,
    duration: Object.freeze({
      mean: average(runs.map((run) => run.wallClockMs)),
      sampleCount: runs.length,
    }),
    ...(cacheSamples.length === 0
      ? {}
      : {
          cacheHitRatio: Object.freeze({
            mean: average(cacheSamples),
            sampleCount: cacheSamples.length,
          }),
        }),
    ...(verifiedCostSamples.length === 0
      ? {}
      : {
          verifiedActualCost: Object.freeze({
            mean: average(verifiedCostSamples),
            sampleCount: verifiedCostSamples.length,
          }),
        }),
  });
}

function buildCategoryLeaderboards(
  entries: readonly ReportLeaderboardEntry[],
): readonly ReportCategoryLeaderboard[] {
  const groups = groupValues(entries, (entry) => entry.category);
  return Object.freeze(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, categoryEntries]) => {
        const ranked = [...categoryEntries]
          .sort(compareLeaderboardEntries)
          .map((entry, index) => Object.freeze({ ...entry, rank: index + 1 }));
        return Object.freeze({
          category,
          entries: Object.freeze(ranked),
          totalEligibleRuns: ranked.reduce((sum, entry) => sum + entry.eligibleRunCount, 0),
          ...(ranked[0] === undefined ? {} : { topSkillId: ranked[0].skillId }),
        });
      }),
  );
}

function buildTrends(runs: readonly EligibleRunRecord[]): readonly ReportTrendPoint[] {
  const groups = groupRuns(runs, (run) => run.completedAt.slice(0, 10));
  return Object.freeze(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, group]) => {
        const passCount = group.filter((run) => run.passedBenchmark).length;
        const costSamples = verifiedCosts(group);
        return Object.freeze({
          date,
          eligibleRunCount: group.length,
          passCount,
          passRate: (passCount / group.length) * 100,
          score: Object.freeze({
            mean: average(group.map((run) => run.compositeScore)),
            sampleCount: group.length,
          }),
          duration: Object.freeze({
            mean: average(group.map((run) => run.wallClockMs)),
            sampleCount: group.length,
          }),
          ...(costSamples.length === 0
            ? {}
            : {
                verifiedActualCost: Object.freeze({
                  mean: average(costSamples),
                  sampleCount: costSamples.length,
                }),
              }),
        });
      }),
  );
}

function buildCostEfficiency(runs: readonly EligibleRunRecord[]): readonly ReportCostPoint[] {
  const verified = runs.filter(hasVerifiedActualCost);
  const groups = groupRuns(
    verified,
    (run) => `${run.category}\u0000${run.skillId}\u0000${run.modelId}`,
  );
  return Object.freeze(
    [...groups.values()]
      .map((group) => {
        const first = requireFirst(group);
        const passCount = group.filter((run) => run.passedBenchmark).length;
        return Object.freeze({
          category: first.category,
          skillId: first.skillId,
          modelId: first.modelId,
          averageVerifiedActualCostUSD: average(group.map((run) => run.actualCostUSD)),
          averageScore: average(group.map((run) => run.compositeScore)),
          passRate: (passCount / group.length) * 100,
          sampleCount: group.length,
        });
      })
      .sort(
        (left, right) =>
          left.category.localeCompare(right.category) ||
          left.skillId.localeCompare(right.skillId) ||
          left.modelId.localeCompare(right.modelId),
      ),
  );
}

function buildLatencyPercentiles(runs: readonly EligibleRunRecord[]): ReportLatencyPercentiles {
  const durations = runs.map((run) => run.wallClockMs);
  return Object.freeze({
    method: "nearest_rank",
    sampleCount: durations.length,
    p50Ms: calculateNearestRankPercentile(durations, 0.5),
    p90Ms: calculateNearestRankPercentile(durations, 0.9),
    p99Ms: calculateNearestRankPercentile(durations, 0.99),
  });
}

function buildTokenVelocity(runs: readonly EligibleRunRecord[]): readonly ReportVelocityPoint[] {
  const observations = runs.flatMap((run) => {
    const durationMs = run.metrics?.timing.modelGenerationDurationMs;
    if (
      durationMs === undefined ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      !Number.isFinite(run.totalTokens)
    )
      return [];
    return [{ run, tokensPerSecond: run.totalTokens / (durationMs / 1000) }];
  });
  const groups = groupValues(
    observations,
    ({ run }) => `${run.category}\u0000${run.skillId}\u0000${run.modelId}`,
  );
  return Object.freeze(
    [...groups.values()]
      .map((group) => {
        const first = requireFirst(group);
        return Object.freeze({
          category: first.run.category,
          skillId: first.run.skillId,
          modelId: first.run.modelId,
          meanTokensPerSecond: average(group.map((item) => item.tokensPerSecond)),
          sampleCount: group.length,
        });
      })
      .sort(
        (left, right) =>
          left.category.localeCompare(right.category) ||
          left.skillId.localeCompare(right.skillId) ||
          left.modelId.localeCompare(right.modelId),
      ),
  );
}

function compareLeaderboardEntries(
  left: Omit<ReportLeaderboardEntry, "rank">,
  right: Omit<ReportLeaderboardEntry, "rank">,
): number {
  return (
    right.passRate - left.passRate ||
    right.score.mean - left.score.mean ||
    right.eligibleRunCount - left.eligibleRunCount ||
    left.category.localeCompare(right.category) ||
    left.skillId.localeCompare(right.skillId)
  );
}

function requireEligibleObservations(runs: readonly EligibleRunRecord[]): void {
  if (
    runs.some((run) => !Number.isFinite(run.compositeScore) || !Number.isFinite(run.wallClockMs))
  ) {
    throw new TypeError("Eligible report observations must be finite");
  }
}

function verifiedCosts(runs: readonly EligibleRunRecord[]): readonly number[] {
  return runs.filter(hasVerifiedActualCost).map((run) => run.actualCostUSD);
}

function hasVerifiedActualCost(run: EligibleRunRecord): run is EligibleRunRecord & {
  readonly operationalCost: VerifiedCostEvidence;
  readonly actualCostUSD: number;
} {
  return run.operationalCost.status === "verified" && run.actualCostUSD !== undefined;
}

function average(values: readonly number[]): number {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value)))
    throw new TypeError("Report mean requires finite samples");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function groupRuns<T extends EligibleRunRecord>(
  runs: readonly T[],
  key: (run: T) => string,
): Map<string, T[]> {
  return groupValues(runs, key);
}

function groupValues<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = groups.get(groupKey);
    if (group === undefined) groups.set(groupKey, [value]);
    else group.push(value);
  }
  return groups;
}

function requireFirst<T>(values: readonly T[]): T {
  const first = values[0];
  if (first === undefined) throw new TypeError("Report aggregation group is empty");
  return first;
}

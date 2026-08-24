import type {
  CategoryLeaderboard,
  CostEfficiencyPoint,
  EloRatingRecord,
  LeaderboardEntry,
  RunRecord,
  SkillBenchmarkSummary,
  StatisticalMetrics,
} from "./types.js";

function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  const p = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.138571095836526, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let a = p[0] ?? 1;
  for (let i = 1; i < p.length; i++) a += (p[i] ?? 0) / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - betaInc(1 - x, b, a);
  const lnBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta) / a;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let c = 1;
  let f = d;
  for (let m = 1; m <= 80; m++) {
    const m2 = 2 * m;
    let num = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    f *= d * c;
    num = -((a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  const res = front * f;
  return Number.isNaN(res) ? 0 : Math.max(0, Math.min(1, res));
}

function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return poly * Math.exp(-x * x);
}

export function computeStatisticalMetrics(values: readonly number[]): StatisticalMetrics {
  const sampleCount = values.length;
  if (sampleCount === 0) {
    return { mean: 0, median: 0, min: 0, max: 0, standardDeviation: 0, confidenceInterval95: [0, 0], sampleCount: 0 };
  }
  const sum = values.reduce((acc, val) => acc + val, 0);
  const mean = sum / sampleCount;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sampleCount / 2);
  const median = sampleCount % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
  const min = sorted[0] ?? mean;
  const max = sorted[sampleCount - 1] ?? mean;
  if (sampleCount === 1) {
    return { mean, median, min, max, standardDeviation: 0, confidenceInterval95: [mean, mean], sampleCount: 1 };
  }
  const sumSq = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0);
  const variance = sumSq / (sampleCount - 1);
  const standardDeviation = Math.sqrt(variance);
  const margin = 1.96 * (standardDeviation / Math.sqrt(sampleCount));
  return {
    mean,
    median,
    min,
    max,
    standardDeviation,
    confidenceInterval95: [mean - margin, mean + margin],
    sampleCount,
  };
}

export function computeWelchTTest(
  sampleA: readonly number[],
  sampleB: readonly number[]
): { readonly tStatistic: number; readonly degreesOfFreedom: number; readonly pValue: number } {
  const nA = sampleA.length;
  const nB = sampleB.length;
  if (nA < 2 || nB < 2) {
    return { tStatistic: 0, degreesOfFreedom: Math.max(1, nA + nB - 2), pValue: 1 };
  }
  const meanA = sampleA.reduce((sum, v) => sum + v, 0) / nA;
  const meanB = sampleB.reduce((sum, v) => sum + v, 0) / nB;
  const varA = sampleA.reduce((sum, v) => sum + Math.pow(v - meanA, 2), 0) / (nA - 1);
  const varB = sampleB.reduce((sum, v) => sum + Math.pow(v - meanB, 2), 0) / (nB - 1);
  const vnA = varA / nA;
  const vnB = varB / nB;
  const se = Math.sqrt(vnA + vnB);
  if (se === 0) return { tStatistic: 0, degreesOfFreedom: Math.max(1, nA + nB - 2), pValue: 1 };
  const tStatistic = (meanA - meanB) / se;
  const dfDenom = Math.pow(vnA, 2) / (nA - 1) + Math.pow(vnB, 2) / (nB - 1);
  const degreesOfFreedom = dfDenom > 0 ? Math.pow(vnA + vnB, 2) / dfDenom : Math.max(1, nA + nB - 2);
  const x = degreesOfFreedom / (degreesOfFreedom + Math.pow(tStatistic, 2));
  const pValue = betaInc(x, degreesOfFreedom / 2, 0.5);
  return { tStatistic, degreesOfFreedom, pValue };
}

export function computeTwoProportionZTest(
  successesA: number,
  totalA: number,
  successesB: number,
  totalB: number
): { readonly zScore: number; readonly pValue: number } {
  if (totalA <= 0 || totalB <= 0) return { zScore: 0, pValue: 1 };
  const pA = successesA / totalA;
  const pB = successesB / totalB;
  const pooledP = (successesA + successesB) / (totalA + totalB);
  if (pooledP <= 0 || pooledP >= 1) return { zScore: 0, pValue: 1 };
  const se = Math.sqrt(pooledP * (1 - pooledP) * (1 / totalA + 1 / totalB));
  if (se === 0) return { zScore: 0, pValue: 1 };
  const zScore = (pA - pB) / se;
  const rawP = erfc(Math.abs(zScore) / Math.SQRT2);
  return { zScore, pValue: Number.isNaN(rawP) ? 1 : Math.max(0, Math.min(1, rawP)) };
}

export function aggregateSkillRuns(
  runs: readonly RunRecord[],
  controlSkillId?: string,
  controlRuns?: readonly RunRecord[]
): SkillBenchmarkSummary {
  const first = runs[0];
  if (!first || runs.length === 0) {
    return {
      skillId: controlSkillId ?? "",
      category: "general",
      totalRuns: 0,
      passRate: 0,
      averageScore: 0,
      meanDurationMs: 0,
      averageCostUSD: 0,
      averageCacheHitRatio: 0,
      eloRating: 1500,
      scoreStats: computeStatisticalMetrics([]),
      durationStats: computeStatisticalMetrics([]),
      costStats: computeStatisticalMetrics([]),
      passRateImprovementOverControl: undefined,
      isStatisticallySignificant: false,
    };
  }

  const skillId = first.skillId;
  const category = first.category;
  const totalRuns = runs.length;
  const passedRuns = runs.filter((r) => r.passedBenchmark).length;
  const passRate = (passedRuns / totalRuns) * 100;
  const scores = runs.map((r) => r.compositeScore);
  const durations = runs.map((r) => r.wallClockMs);
  const costs = runs.map((r) => r.totalCostUSD);
  const cacheHitRatios = runs.map((r) => r.cacheHitRatio);

  let scoreStats = computeStatisticalMetrics(scores);
  let durationStats = computeStatisticalMetrics(durations);
  let costStats = computeStatisticalMetrics(costs);
  const averageCacheHitRatio = cacheHitRatios.length > 0 ? cacheHitRatios.reduce((a, b) => a + b, 0) / cacheHitRatios.length : 0;

  let passRateImprovementOverControl: number | undefined;
  let isStatisticallySignificant = false;

  if (controlRuns && controlRuns.length > 0 && (!controlSkillId || skillId !== controlSkillId)) {
    const controlTotal = controlRuns.length;
    const controlPassed = controlRuns.filter((r) => r.passedBenchmark).length;
    passRateImprovementOverControl = passRate - (controlPassed / controlTotal) * 100;

    const zTest = computeTwoProportionZTest(passedRuns, totalRuns, controlPassed, controlTotal);
    const scoreTest = computeWelchTTest(scores, controlRuns.map((r) => r.compositeScore));
    const durationTest = computeWelchTTest(durations, controlRuns.map((r) => r.wallClockMs));
    const costTest = computeWelchTTest(costs, controlRuns.map((r) => r.totalCostUSD));

    scoreStats = { ...scoreStats, pValueAgainstControl: scoreTest.pValue, isStatisticallySignificant: scoreTest.pValue < 0.05 };
    durationStats = { ...durationStats, pValueAgainstControl: durationTest.pValue, isStatisticallySignificant: durationTest.pValue < 0.05 };
    costStats = { ...costStats, pValueAgainstControl: costTest.pValue, isStatisticallySignificant: costTest.pValue < 0.05 };
    isStatisticallySignificant = zTest.pValue < 0.05 || scoreTest.pValue < 0.05;
  } else if (controlSkillId && skillId === controlSkillId) {
    passRateImprovementOverControl = 0;
    isStatisticallySignificant = false;
  }

  return {
    skillId,
    category,
    totalRuns,
    passRate,
    averageScore: scoreStats.mean,
    meanDurationMs: durationStats.mean,
    averageCostUSD: costStats.mean,
    averageCacheHitRatio,
    eloRating: 1500,
    scoreStats,
    durationStats,
    costStats,
    passRateImprovementOverControl,
    isStatisticallySignificant,
  };
}

export function aggregateAllSkills(
  runs: readonly RunRecord[],
  controlSkillId?: string
): ReadonlyArray<SkillBenchmarkSummary> {
  const runsBySkill = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const list = runsBySkill.get(run.skillId);
    if (list) list.push(run);
    else runsBySkill.set(run.skillId, [run]);
  }
  const controlRuns = controlSkillId ? runsBySkill.get(controlSkillId) : undefined;
  const summaries: SkillBenchmarkSummary[] = [];
  for (const [skillId, skillRuns] of runsBySkill.entries()) {
    const isControl = Boolean(controlSkillId && skillId === controlSkillId);
    summaries.push(aggregateSkillRuns(skillRuns, controlSkillId, isControl ? undefined : controlRuns));
  }
  return summaries.sort((a, b) => b.passRate !== a.passRate ? b.passRate - a.passRate : b.averageScore - a.averageScore);
}

export function buildLeaderboardEntries(
  summaries: readonly SkillBenchmarkSummary[],
  eloRecords?: readonly EloRatingRecord[]
): ReadonlyArray<LeaderboardEntry> {
  const eloMap = new Map<string, number>();
  if (eloRecords) {
    for (const rec of eloRecords) eloMap.set(rec.skillId, rec.rating);
  }
  const entries: LeaderboardEntry[] = summaries.map((s) => ({
    rank: 0,
    skillId: s.skillId,
    category: s.category,
    passRate: s.passRate,
    passRateDeltaOverControl: s.passRateImprovementOverControl,
    eloRating: eloMap.get(s.skillId) ?? s.eloRating,
    averageScore: s.averageScore,
    meanDurationSeconds: s.meanDurationMs / 1000,
    averageCostUSD: s.averageCostUSD,
    cacheHitRatio: s.averageCacheHitRatio,
    isStatisticallySignificant: s.isStatisticallySignificant ?? false,
    totalRuns: s.totalRuns,
  }));
  entries.sort((a, b) => {
    if (eloRecords && eloRecords.length > 0 && b.eloRating !== a.eloRating) return b.eloRating - a.eloRating;
    if (b.passRate !== a.passRate) return b.passRate - a.passRate;
    return b.averageScore - a.averageScore;
  });
  return entries.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function buildCategoryLeaderboards(
  entries: readonly LeaderboardEntry[]
): ReadonlyArray<CategoryLeaderboard> {
  const entriesByCategory = new Map<string, LeaderboardEntry[]>();
  for (const entry of entries) {
    const list = entriesByCategory.get(entry.category);
    if (list) list.push(entry);
    else entriesByCategory.set(entry.category, [entry]);
  }
  const result: CategoryLeaderboard[] = [];
  for (const [category, catEntries] of entriesByCategory.entries()) {
    const ranked = catEntries
      .slice()
      .sort((a, b) => b.eloRating !== a.eloRating ? b.eloRating - a.eloRating : b.passRate !== a.passRate ? b.passRate - a.passRate : b.averageScore - a.averageScore)
      .map((entry, idx) => ({ ...entry, rank: idx + 1 }));
    result.push({
      category,
      entries: ranked,
      topSkillId: ranked[0]?.skillId ?? "",
      totalRuns: ranked.reduce((sum, e) => sum + e.totalRuns, 0),
      updatedAt: new Date().toISOString(),
    });
  }
  return result.sort((a, b) => a.category.localeCompare(b.category));
}

export function extractCostEfficiencyPoints(
  summaries: readonly SkillBenchmarkSummary[]
): ReadonlyArray<CostEfficiencyPoint> {
  return summaries.map((summary) => ({
    skillId: summary.skillId,
    modelId: "all",
    averageCostUSD: summary.averageCostUSD,
    compositeScore: summary.averageScore,
    passRate: summary.passRate,
    tokensPerTask: 0,
    durationMs: summary.meanDurationMs,
  }));
}

export function extractCostEfficiencyPointsFromRuns(
  runs: readonly RunRecord[]
): ReadonlyArray<CostEfficiencyPoint> {
  const groups = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const key = `${run.skillId}:::${run.modelId}`;
    const list = groups.get(key);
    if (list) list.push(run);
    else groups.set(key, [run]);
  }
  const result: CostEfficiencyPoint[] = [];
  for (const groupRuns of groups.values()) {
    const first = groupRuns[0];
    if (!first || groupRuns.length === 0) continue;
    const totalRuns = groupRuns.length;
    const passed = groupRuns.filter((r) => r.passedBenchmark).length;
    result.push({
      skillId: first.skillId,
      modelId: first.modelId,
      averageCostUSD: groupRuns.reduce((sum, r) => sum + r.totalCostUSD, 0) / totalRuns,
      compositeScore: groupRuns.reduce((sum, r) => sum + r.compositeScore, 0) / totalRuns,
      passRate: (passed / totalRuns) * 100,
      tokensPerTask: groupRuns.reduce((sum, r) => sum + r.totalTokens, 0) / totalRuns,
      durationMs: groupRuns.reduce((sum, r) => sum + r.wallClockMs, 0) / totalRuns,
    });
  }
  return result.sort((a, b) => a.skillId !== b.skillId ? a.skillId.localeCompare(b.skillId) : a.modelId.localeCompare(b.modelId));
}

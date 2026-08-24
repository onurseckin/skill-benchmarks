import type { RunRecord, SkillBenchmarkSummary } from "../reporting/types.js";
import type {
  EloDriftThresholds,
  MetricDelta,
  RegressionComparisonInput,
  RegressionDetectorConfig,
  RegressionStatus,
  RegressionSummary,
  RegressionVerdictStatus,
  ScenarioRegressionDelta,
  SkillRegressionDelta,
} from "./types.js";

export const DEFAULT_ELO_DRIFT_THRESHOLDS: EloDriftThresholds = {
  warningDriftThreshold: 25,
  criticalDriftThreshold: 50,
  maxAllowedScoreDrop: 5.0,
  maxAllowedPassRateDrop: 5.0,
  significanceAlpha: 0.05,
  minSampleCount: 3,
};

export const DEFAULT_REGRESSION_DETECTOR_CONFIG: RegressionDetectorConfig = {
  thresholds: DEFAULT_ELO_DRIFT_THRESHOLDS,
  failOnCriticalRegression: true,
  failOnAnyRegression: false,
  minSampleCountForSignificance: 3,
};

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
  let c = 1, f = d;
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

export function computeMean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function computeVariance(values: readonly number[], mean: number): number {
  if (values.length < 2) return 0;
  return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
}

export function formatPValue(pValue: number): string {
  if (pValue < 0.001) return "< 0.001";
  if (pValue < 0.01) return "< 0.01";
  return pValue.toFixed(3);
}

export function formatEffectSize(d: number): string {
  const absD = Math.abs(d);
  const desc = absD >= 0.8 ? "large" : absD >= 0.5 ? "medium" : absD >= 0.2 ? "small" : "negligible";
  return `${d.toFixed(2)} (${desc})`;
}

export function computeWelchTTest(
  sampleA: readonly number[],
  sampleB: readonly number[]
): { readonly tStatistic: number; readonly degreesOfFreedom: number; readonly pValue: number } {
  const nA = sampleA.length, nB = sampleB.length;
  if (nA < 2 || nB < 2) return { tStatistic: 0, degreesOfFreedom: Math.max(1, nA + nB - 2), pValue: 1 };
  const meanA = computeMean(sampleA), meanB = computeMean(sampleB);
  const varA = computeVariance(sampleA, meanA), varB = computeVariance(sampleB, meanB);
  const vnA = varA / nA, vnB = varB / nB;
  const se = Math.sqrt(vnA + vnB);
  if (se === 0) return { tStatistic: 0, degreesOfFreedom: Math.max(1, nA + nB - 2), pValue: 1 };
  const tStatistic = (meanA - meanB) / se;
  const dfDenom = Math.pow(vnA, 2) / (nA - 1) + Math.pow(vnB, 2) / (nB - 1);
  const degreesOfFreedom = dfDenom > 0 ? Math.pow(vnA + vnB, 2) / dfDenom : Math.max(1, nA + nB - 2);
  const x = degreesOfFreedom / (degreesOfFreedom + Math.pow(tStatistic, 2));
  const pValue = betaInc(x, degreesOfFreedom / 2, 0.5);
  return { tStatistic, degreesOfFreedom, pValue };
}

export function computeCohensD(sampleA: readonly number[], sampleB: readonly number[]): number {
  const nA = sampleA.length, nB = sampleB.length;
  if (nA < 2 || nB < 2) return 0;
  const meanA = computeMean(sampleA), meanB = computeMean(sampleB);
  const varA = computeVariance(sampleA, meanA), varB = computeVariance(sampleB, meanB);
  const pooledVar = ((nA - 1) * varA + (nB - 1) * varB) / (nA + nB - 2);
  return pooledVar > 0 ? (meanA - meanB) / Math.sqrt(pooledVar) : 0;
}

export function computeMetricDelta(
  metricName: string,
  baselineValues: readonly number[],
  candidateValues: readonly number[],
  higherIsBetter: boolean = true,
  alpha: number = 0.05
): MetricDelta {
  const baseMean = computeMean(baselineValues);
  const candMean = computeMean(candidateValues);
  const absoluteDelta = candMean - baseMean;
  const percentageDelta = baseMean !== 0 ? (absoluteDelta / Math.abs(baseMean)) * 100 : 0;
  const tTest = computeWelchTTest(candidateValues, baselineValues);
  const effectSize = computeCohensD(candidateValues, baselineValues);
  const isStatisticallySignificant = tTest.pValue < alpha && baselineValues.length >= 2 && candidateValues.length >= 2;
  return {
    metricName,
    baselineValue: baseMean,
    candidateValue: candMean,
    absoluteDelta,
    percentageDelta,
    isImprovement: higherIsBetter ? absoluteDelta > 0 : absoluteDelta < 0,
    isRegression: higherIsBetter ? absoluteDelta < 0 : absoluteDelta > 0,
    isStatisticallySignificant,
    pValue: tTest.pValue,
    effectSize,
  };
}

export class RegressionDetector {
  public readonly config: RegressionDetectorConfig;

  constructor(customConfig?: Partial<RegressionDetectorConfig>) {
    this.config = {
      thresholds: { ...DEFAULT_ELO_DRIFT_THRESHOLDS, ...(customConfig?.thresholds ?? {}) },
      failOnCriticalRegression: customConfig?.failOnCriticalRegression ?? true,
      failOnAnyRegression: customConfig?.failOnAnyRegression ?? false,
      minSampleCountForSignificance: customConfig?.minSampleCountForSignificance ?? 3,
      baselineDbPath: customConfig?.baselineDbPath,
      candidateDbPath: customConfig?.candidateDbPath,
    };
  }

  public compareSkill(
    skillId: string,
    category: string,
    baselineRuns: readonly RunRecord[],
    candidateRuns: readonly RunRecord[],
    baselineSummary?: SkillBenchmarkSummary,
    candidateSummary?: SkillBenchmarkSummary
  ): SkillRegressionDelta {
    const baseScores = baselineRuns.map((r) => r.compositeScore);
    const candScores = candidateRuns.map((r) => r.compositeScore);
    const basePasses = baselineRuns.map((r) => (r.passedBenchmark ? 100 : 0));
    const candPasses = candidateRuns.map((r) => (r.passedBenchmark ? 100 : 0));

    const baselineScore = baseScores.length > 0 ? computeMean(baseScores) : (baselineSummary?.averageScore ?? 0);
    const candidateScore = candScores.length > 0 ? computeMean(candScores) : (candidateSummary?.averageScore ?? 0);
    const scoreDelta = candidateScore - baselineScore;

    const baselinePassRate = basePasses.length > 0 ? computeMean(basePasses) : (baselineSummary?.passRate ?? 0);
    const candidatePassRate = candPasses.length > 0 ? computeMean(candPasses) : (candidateSummary?.passRate ?? 0);
    const passRateDelta = candidatePassRate - baselinePassRate;

    const baselineDurationMs = computeMean(baselineRuns.map((r) => r.wallClockMs));
    const candidateDurationMs = computeMean(candidateRuns.map((r) => r.wallClockMs));
    const baselineCostUSD = computeMean(baselineRuns.map((r) => r.totalCostUSD));
    const candidateCostUSD = computeMean(candidateRuns.map((r) => r.totalCostUSD));
    const baselineTokensMean = computeMean(baselineRuns.map((r) => r.totalTokens));
    const candidateTokensMean = computeMean(candidateRuns.map((r) => r.totalTokens));
    const baselineCacheHitRatio = computeMean(baselineRuns.map((r) => r.cacheHitRatio));
    const candidateCacheHitRatio = computeMean(candidateRuns.map((r) => r.cacheHitRatio));

    const baselineElo = baselineSummary?.eloRating ?? 1500;
    const candidateElo = candidateSummary?.eloRating ?? 1500;
    const eloDelta = candidateElo - baselineElo;

    const tTest = computeWelchTTest(candScores, baseScores);
    const hasEnoughSamples = baseScores.length >= this.config.thresholds.minSampleCount && candScores.length >= this.config.thresholds.minSampleCount;
    const isStatisticallySignificant = hasEnoughSamples && tTest.pValue < this.config.thresholds.significanceAlpha;

    let status: RegressionStatus = "neutral";
    const scoreDrop = baselineScore - candidateScore;
    const passDrop = baselinePassRate - candidatePassRate;
    const eloDrop = baselineElo - candidateElo;

    if (
      eloDrop >= this.config.thresholds.criticalDriftThreshold ||
      (scoreDrop >= this.config.thresholds.maxAllowedScoreDrop && isStatisticallySignificant) ||
      (passDrop >= this.config.thresholds.maxAllowedPassRateDrop && isStatisticallySignificant)
    ) {
      status = "critical_regression";
    } else if (
      eloDrop >= this.config.thresholds.warningDriftThreshold ||
      (scoreDrop > 0 && isStatisticallySignificant) ||
      (passDrop > 0 && isStatisticallySignificant)
    ) {
      status = "regressed";
    } else if ((scoreDelta > 0 && isStatisticallySignificant) || (passRateDelta > 0 && isStatisticallySignificant) || eloDelta >= this.config.thresholds.warningDriftThreshold) {
      status = "improved";
    }

    return {
      skillId,
      category,
      baselineScore,
      candidateScore,
      scoreDelta,
      baselinePassRate,
      candidatePassRate,
      passRateDelta,
      baselineDurationMs,
      candidateDurationMs,
      durationDeltaMs: candidateDurationMs - baselineDurationMs,
      baselineCostUSD,
      candidateCostUSD,
      costDeltaUSD: candidateCostUSD - baselineCostUSD,
      baselineTokens: baselineTokensMean,
      candidateTokens: candidateTokensMean,
      tokenDelta: candidateTokensMean - baselineTokensMean,
      baselineCacheHitRatio,
      candidateCacheHitRatio,
      cacheHitRatioDelta: candidateCacheHitRatio - baselineCacheHitRatio,
      baselineElo,
      candidateElo,
      eloDelta,
      pValue: tTest.pValue,
      isStatisticallySignificant,
      status,
    };
  }

  public compareScenario(
    scenarioId: string,
    baselineRuns: readonly RunRecord[],
    candidateRuns: readonly RunRecord[]
  ): ScenarioRegressionDelta {
    const baseScores = baselineRuns.map((r) => r.compositeScore);
    const candScores = candidateRuns.map((r) => r.compositeScore);
    const basePasses = baselineRuns.map((r) => (r.passedBenchmark ? 100 : 0));
    const candPasses = candidateRuns.map((r) => (r.passedBenchmark ? 100 : 0));
    const baselineScore = computeMean(baseScores);
    const candidateScore = computeMean(candScores);
    const scoreDelta = candidateScore - baselineScore;
    const baselinePassRate = computeMean(basePasses);
    const candidatePassRate = computeMean(candPasses);
    const passRateDelta = candidatePassRate - baselinePassRate;
    const baselineDurationMs = computeMean(baselineRuns.map((r) => r.wallClockMs));
    const candidateDurationMs = computeMean(candidateRuns.map((r) => r.wallClockMs));

    let status: RegressionStatus = "neutral";
    if (scoreDelta < -this.config.thresholds.maxAllowedScoreDrop || passRateDelta < -this.config.thresholds.maxAllowedPassRateDrop) {
      status = "critical_regression";
    } else if (scoreDelta < 0 || passRateDelta < 0) {
      status = "regressed";
    } else if (scoreDelta > 0 || passRateDelta > 0) {
      status = "improved";
    }

    return {
      scenarioId,
      baselinePassRate,
      candidatePassRate,
      passRateDelta,
      baselineDurationMs,
      candidateDurationMs,
      durationDeltaMs: candidateDurationMs - baselineDurationMs,
      baselineScore,
      candidateScore,
      scoreDelta,
      status,
    };
  }

  public evaluate(input: RegressionComparisonInput): RegressionSummary {
    const skillIds = new Set<string>();
    const categoryMap = new Map<string, string>();
    for (const r of [...input.baselineRuns, ...input.candidateRuns]) {
      skillIds.add(r.skillId);
      if (r.category) categoryMap.set(r.skillId, r.category);
    }

    const baselineSummariesMap = new Map<string, SkillBenchmarkSummary>();
    if (input.baselineSummaries) {
      for (const s of input.baselineSummaries) baselineSummariesMap.set(s.skillId, s);
    }
    const candidateSummariesMap = new Map<string, SkillBenchmarkSummary>();
    if (input.candidateSummaries) {
      for (const s of input.candidateSummaries) candidateSummariesMap.set(s.skillId, s);
    }

    const skillDeltas = Array.from(skillIds).map((skillId) => {
      const bRuns = input.baselineRuns.filter((r) => r.skillId === skillId);
      const cRuns = input.candidateRuns.filter((r) => r.skillId === skillId);
      const category = categoryMap.get(skillId) ?? "general";
      return this.compareSkill(skillId, category, bRuns, cRuns, baselineSummariesMap.get(skillId), candidateSummariesMap.get(skillId));
    });

    const scenarioIds = new Set<string>();
    for (const r of [...input.baselineRuns, ...input.candidateRuns]) scenarioIds.add(r.scenarioId);

    const scenarioDeltas = Array.from(scenarioIds).map((scenarioId) => {
      const bRuns = input.baselineRuns.filter((r) => r.scenarioId === scenarioId);
      const cRuns = input.candidateRuns.filter((r) => r.scenarioId === scenarioId);
      return this.compareScenario(scenarioId, bRuns, cRuns);
    });

    const improvedSkillsCount = skillDeltas.filter((s) => s.status === "improved").length;
    const regressedSkillsCount = skillDeltas.filter((s) => s.status === "regressed").length;
    const criticalRegressionsCount = skillDeltas.filter((s) => s.status === "critical_regression").length;
    const neutralSkillsCount = skillDeltas.filter((s) => s.status === "neutral").length;

    const baseAllScores = input.baselineRuns.map((r) => r.compositeScore);
    const candAllScores = input.candidateRuns.map((r) => r.compositeScore);
    const overallScoreDelta = candAllScores.length > 0 && baseAllScores.length > 0 ? computeMean(candAllScores) - computeMean(baseAllScores) : 0;
    const baseAllPasses = input.baselineRuns.map((r) => (r.passedBenchmark ? 100 : 0));
    const candAllPasses = input.candidateRuns.map((r) => (r.passedBenchmark ? 100 : 0));
    const overallPassRateDelta = candAllPasses.length > 0 && baseAllPasses.length > 0 ? computeMean(candAllPasses) - computeMean(baseAllPasses) : 0;
    const overallEloDrift = computeMean(skillDeltas.map((s) => s.eloDelta));

    const overallTTest = computeWelchTTest(candAllScores, baseAllScores);
    const isStatisticallySignificant = overallTTest.pValue < this.config.thresholds.significanceAlpha && baseAllScores.length >= 3 && candAllScores.length >= 3;

    const criticalFindings: string[] = [];
    const recommendations: string[] = [];
    for (const s of skillDeltas) {
      if (s.status === "critical_regression") {
        criticalFindings.push(`Critical regression in skill "${s.skillId}": score dropped by ${Math.abs(s.scoreDelta).toFixed(1)}pts, Elo drift ${s.eloDelta.toFixed(0)}.`);
        recommendations.push(`Review prompt and tool changes in ${s.skillId} to restore baseline performance.`);
      } else if (s.status === "regressed") {
        criticalFindings.push(`Regression in skill "${s.skillId}": score dropped by ${Math.abs(s.scoreDelta).toFixed(1)}pts.`);
        recommendations.push(`Inspect failing tests in ${s.skillId}.`);
      }
    }

    let verdict: RegressionVerdictStatus = "PASS";
    if (criticalRegressionsCount > 0 && this.config.failOnCriticalRegression) {
      verdict = "FAIL";
    } else if (regressedSkillsCount > 0 && this.config.failOnAnyRegression) {
      verdict = "FAIL";
    } else if (criticalRegressionsCount > 0 || regressedSkillsCount > 0) {
      verdict = "WARNING";
    }

    return {
      verdict,
      totalSkillsEvaluated: skillDeltas.length,
      improvedSkillsCount,
      regressedSkillsCount,
      criticalRegressionsCount,
      neutralSkillsCount,
      overallScoreDelta,
      overallPassRateDelta,
      overallEloDrift,
      isStatisticallySignificant,
      skillDeltas,
      scenarioDeltas,
      criticalFindings,
      recommendations,
      evaluatedAt: new Date().toISOString(),
    };
  }
}

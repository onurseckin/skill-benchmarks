import type {
  ArenaEloDelta,
  ArenaEloMatchOutcome,
  ArenaLeaderboardEntry,
  ArenaLeaderboardSummary,
  ConsensusAggregationMethod,
  ConsensusArbitrationResult,
  ConsensusConfidenceInterval,
  ConsensusDissentingOpinion,
  ConsensusScoreDimensionSummary,
  ConsensusScorerOptions,
  ConsensusVerdict,
  DebateTranscript,
  JurorEvaluation,
  OutlierDetectionMethod,
  OutlierJurorReport,
} from "./types.js";
import type { Arena } from "./index.js";
export type ArenaInstance = Arena;

function computeMean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function computeVariance(values: readonly number[], mean: number): number {
  if (values.length <= 1) return 0;
  return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
}

function computeMedian(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function computeConfidenceInterval(
  mean: number,
  stdDev: number,
  n: number,
  confidenceLevel: number = 0.95
): ConsensusConfidenceInterval {
  const z = confidenceLevel >= 0.99 ? 2.576 : confidenceLevel >= 0.95 ? 1.96 : 1.645;
  const margin = n > 0 ? (z * stdDev) / Math.sqrt(n) : 0;
  return { lower: Math.max(0, mean - margin), upper: Math.min(1, mean + margin), confidenceLevel };
}

export class ConsensusScorer {
  private readonly aggregationMethod: ConsensusAggregationMethod;
  private readonly outlierMethod: OutlierDetectionMethod;
  private readonly outlierThreshold: number;
  private readonly defaultKFactor: number;
  private readonly initialElo: number;
  private readonly discountSelfBias: boolean;

  public constructor(options?: ConsensusScorerOptions) {
    this.aggregationMethod = options?.aggregationMethod ?? "bayesian_mean";
    this.outlierMethod = options?.outlierDetectionMethod ?? "z_score";
    this.outlierThreshold = options?.outlierThreshold ?? 2.0;
    this.defaultKFactor = options?.kFactor ?? 32;
    this.initialElo = options?.initialElo ?? 1500;
    this.discountSelfBias = options?.discountSelfBias ?? true;
  }

  public detectOutliers(evaluations: readonly JurorEvaluation[], proposerModelId: string): readonly OutlierJurorReport[] {
    if (evaluations.length < 3) {
      return evaluations.map((e) => ({
        jurorId: e.jurorId,
        modelId: e.modelId,
        zScore: 0,
        deviationFromMean: 0,
        detectedMethod: "none",
        isExcluded: false,
        discountFactor: 1.0,
      }));
    }

    const scores = evaluations.map((e) => e.overallScore);
    const mean = computeMean(scores);
    const stdDev = Math.sqrt(computeVariance(scores, mean));
    const median = computeMedian(scores);
    const mad = computeMedian(scores.map((s) => Math.abs(s - median)));

    return evaluations.map((evaluation) => {
      const score = evaluation.overallScore;
      const deviationFromMean = score - mean;
      const zScore = stdDev > 0 ? Math.abs(deviationFromMean) / stdDev : 0;
      const modifiedZ = mad > 0 ? (0.6745 * Math.abs(score - median)) / mad : 0;

      let isOutlier = false;
      let detectedMethod: OutlierDetectionMethod = "none";
      if (this.outlierMethod === "z_score" && zScore > this.outlierThreshold) {
        isOutlier = true;
        detectedMethod = "z_score";
      } else if (this.outlierMethod === "modified_z_score" && modifiedZ > 3.5) {
        isOutlier = true;
        detectedMethod = "modified_z_score";
      }

      let discountFactor = isOutlier ? 0.25 : 1.0;
      if (this.discountSelfBias && evaluation.modelId === proposerModelId) {
        discountFactor *= 0.8;
      }

      return {
        jurorId: evaluation.jurorId,
        modelId: evaluation.modelId,
        zScore,
        deviationFromMean,
        detectedMethod,
        isExcluded: isOutlier && discountFactor < 0.3,
        discountFactor,
      };
    });
  }

  public computeDimensionSummaries(
    evaluations: readonly JurorEvaluation[],
    outlierReports: readonly OutlierJurorReport[]
  ): readonly ConsensusScoreDimensionSummary[] {
    const outlierMap = new Map(outlierReports.map((r) => [r.jurorId, r]));
    const dimensionMap = new Map<string, Array<{ score: number; weight: number }>>();

    for (const evaluation of evaluations) {
      const report = outlierMap.get(evaluation.jurorId);
      if (report?.isExcluded) continue;
      const jurorWeight = (report?.discountFactor ?? 1.0) * Math.max(0.1, evaluation.confidence);
      for (const ds of evaluation.scores) {
        const list = dimensionMap.get(ds.dimension) ?? [];
        list.push({ score: ds.normalizedScore, weight: jurorWeight });
        dimensionMap.set(ds.dimension, list);
      }
    }

    const summaries: ConsensusScoreDimensionSummary[] = [];
    for (const [dimension, entries] of dimensionMap.entries()) {
      const rawScores = entries.map((e) => e.score);
      const mean = computeMean(rawScores);
      const variance = computeVariance(rawScores, mean);
      const stdDev = Math.sqrt(variance);
      const totalWeight = entries.reduce((acc, e) => acc + e.weight, 0);
      const weightedScore = totalWeight > 0 ? entries.reduce((acc, e) => acc + e.score * e.weight, 0) / totalWeight : mean;
      const confidenceInterval = computeConfidenceInterval(weightedScore, stdDev, entries.length);
      summaries.push({
        dimension,
        meanScore: Number(mean.toFixed(4)),
        weightedScore: Number(weightedScore.toFixed(4)),
        confidenceInterval,
        variance: Number(variance.toFixed(6)),
        stdDev: Number(stdDev.toFixed(4)),
      });
    }
    return summaries;
  }

  public determineVerdict(
    evaluations: readonly JurorEvaluation[],
    outlierReports: readonly OutlierJurorReport[],
    threshold: number = 0.67
  ): {
    readonly verdict: ConsensusVerdict;
    readonly winningParticipantId?: string;
    readonly dissentingOpinions: readonly ConsensusDissentingOpinion[];
  } {
    const outlierMap = new Map(outlierReports.map((r) => [r.jurorId, r]));
    const activeEvals = evaluations.filter((e) => !outlierMap.get(e.jurorId)?.isExcluded);
    if (activeEvals.length === 0) {
      return { verdict: "hung_jury", dissentingOpinions: [] };
    }

    const verdictCounts = new Map<string, number>();
    const winnerCounts = new Map<string, number>();
    for (const ev of activeEvals) {
      verdictCounts.set(ev.verdict, (verdictCounts.get(ev.verdict) ?? 0) + 1);
      if (ev.winner) winnerCounts.set(ev.winner, (winnerCounts.get(ev.winner) ?? 0) + 1);
    }

    let topVerdict = "inconclusive";
    let topCount = 0;
    for (const [verdict, count] of verdictCounts.entries()) {
      if (count > topCount) {
        topCount = count;
        topVerdict = verdict;
      }
    }

    let topWinner: string | undefined;
    let topWinnerCount = 0;
    for (const [winner, count] of winnerCounts.entries()) {
      if (count > topWinnerCount) {
        topWinnerCount = count;
        topWinner = winner;
      }
    }

    const majorityRatio = topCount / activeEvals.length;
    let verdict: ConsensusVerdict = "split";
    if (majorityRatio === 1.0) verdict = "unanimous";
    else if (majorityRatio >= threshold) verdict = "supermajority";
    else if (majorityRatio > 0.5) verdict = "simple_majority";
    else if (majorityRatio <= 0.34 && activeEvals.length >= 3) verdict = "hung_jury";

    const dissentingOpinions: ConsensusDissentingOpinion[] = activeEvals
      .filter((ev) => ev.verdict !== topVerdict && ev.dissentingReason)
      .map((ev) => ({
        jurorId: ev.jurorId,
        modelId: ev.modelId,
        reason: ev.dissentingReason as string,
        proposedVerdict: ev.verdict,
      }));

    return { verdict, winningParticipantId: topWinner, dissentingOpinions };
  }

  public arbitrateDebate(transcript: DebateTranscript, evaluations: readonly JurorEvaluation[]): ConsensusArbitrationResult {
    const startTime = Date.now();
    const proposerId = transcript.config.proposerModel.id;
    const outlierReports = this.detectOutliers(evaluations, proposerId);
    const dimensionSummaries = this.computeDimensionSummaries(evaluations, outlierReports);
    const threshold = transcript.config.consensusThreshold ?? 0.67;
    const { verdict, winningParticipantId, dissentingOpinions } = this.determineVerdict(evaluations, outlierReports, threshold);

    const compositeScore = dimensionSummaries.length > 0
      ? computeMean(dimensionSummaries.map((d) => d.weightedScore))
      : computeMean(evaluations.map((e) => e.overallScore));

    const effectiveSampleSize = evaluations.filter((e) => !outlierReports.find((r) => r.jurorId === e.jurorId)?.isExcluded).length;
    const bayesianCalibratedScore = (0.5 * 2.0 + compositeScore * effectiveSampleSize) / (2.0 + effectiveSampleSize);
    const overallConfidence = evaluations.length > 0 ? computeMean(evaluations.map((e) => e.confidence)) : 0.5;

    return {
      debateId: transcript.debateId,
      verdict,
      winningParticipantId,
      aggregationMethod: this.aggregationMethod,
      overallScore: Number(compositeScore.toFixed(4)),
      overallConfidence: Number(overallConfidence.toFixed(4)),
      dimensionSummaries,
      jurorEvaluations: evaluations,
      outlierReports,
      dissentingOpinions,
      calibratedScore: Number(bayesianCalibratedScore.toFixed(4)),
      arbitrationTimeMs: Date.now() - startTime,
    };
  }

  public calculateExpectedScore(ratingA: number, ratingB: number): number {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  }

  public computeEloDeltas(
    participantA: string,
    modelIdA: string,
    ratingA: number,
    matchesA: number,
    participantB: string,
    modelIdB: string,
    ratingB: number,
    matchesB: number,
    actualScoreA: number,
    confidence: number = 1.0
  ): { readonly deltaA: ArenaEloDelta; readonly deltaB: ArenaEloDelta } {
    const kA = matchesA < 10 ? this.defaultKFactor * 1.5 : this.defaultKFactor;
    const kB = matchesB < 10 ? this.defaultKFactor * 1.5 : this.defaultKFactor;
    const expectedA = this.calculateExpectedScore(ratingA, ratingB);
    const expectedB = 1 - expectedA;
    const postA = Math.round(ratingA + kA * (actualScoreA - expectedA) * confidence);
    const postB = Math.round(ratingB + kB * ((1 - actualScoreA) - expectedB) * confidence);

    return {
      deltaA: {
        participantId: participantA,
        modelId: modelIdA,
        preRating: ratingA,
        postRating: postA,
        delta: postA - ratingA,
        expectedScore: Number(expectedA.toFixed(4)),
        actualScore: actualScoreA,
        kFactor: kA,
        matchesPlayed: matchesA + 1,
      },
      deltaB: {
        participantId: participantB,
        modelId: modelIdB,
        preRating: ratingB,
        postRating: postB,
        delta: postB - ratingB,
        expectedScore: Number(expectedB.toFixed(4)),
        actualScore: 1 - actualScoreA,
        kFactor: kB,
        matchesPlayed: matchesB + 1,
      },
    };
  }

  public computeLeaderboard(
    entries: readonly ArenaLeaderboardEntry[],
    matches: readonly ArenaEloMatchOutcome[]
  ): ArenaLeaderboardSummary {
    const stats = new Map<string, { modelId: string; rating: number; wins: number; losses: number; draws: number; total: number; conf: number }>();
    for (const e of entries) {
      stats.set(e.participantId, { modelId: e.modelId, rating: e.rating, wins: e.wins, losses: e.losses, draws: e.draws, total: e.totalMatches, conf: e.averageConfidence * e.totalMatches });
    }
    for (const m of matches) {
      const recA = stats.get(m.participantA) ?? { modelId: m.deltaA.modelId, rating: this.initialElo, wins: 0, losses: 0, draws: 0, total: 0, conf: 0 };
      const recB = stats.get(m.participantB) ?? { modelId: m.deltaB.modelId, rating: this.initialElo, wins: 0, losses: 0, draws: 0, total: 0, conf: 0 };
      recA.rating = m.deltaA.postRating;
      recB.rating = m.deltaB.postRating;
      recA.total += 1;
      recB.total += 1;
      recA.conf += 1.0;
      recB.conf += 1.0;
      if (m.scoreA > m.scoreB) { recA.wins += 1; recB.losses += 1; }
      else if (m.scoreB > m.scoreA) { recB.wins += 1; recA.losses += 1; }
      else { recA.draws += 1; recB.draws += 1; }
      stats.set(m.participantA, recA);
      stats.set(m.participantB, recB);
    }
    const list: ArenaLeaderboardEntry[] = [];
    for (const [id, s] of stats.entries()) {
      list.push({
        participantId: id,
        modelId: s.modelId,
        rating: s.rating,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        totalMatches: s.total,
        winRate: s.total > 0 ? Number((s.wins / s.total).toFixed(4)) : 0,
        averageConfidence: s.total > 0 ? Number((s.conf / s.total).toFixed(4)) : 1.0,
        rank: 0,
      });
    }
    list.sort((a, b) => (b.rating !== a.rating ? b.rating - a.rating : b.winRate !== a.winRate ? b.winRate - a.winRate : b.averageConfidence - a.averageConfidence));
    return {
      updatedAt: Date.now(),
      totalMatches: matches.length,
      entries: list.map((e, i) => ({ ...e, rank: i + 1 })),
    };
  }
}

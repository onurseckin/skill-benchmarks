import {
  BudgetController,
} from "./budget-controller.js";
import {
  CostEfficiencyMetrics,
  LatencyOptimizationHeuristic,
  ModelRoutingRecommendation,
  OptimizationConstraint,
  OptimizationReport,
  OptimizerTarget,
  ParetoCandidate,
  ParetoFrontierPoint,
} from "./types.js";

export class OptimizerEngine {
  private readonly budgetController: BudgetController;
  private readonly heuristics = new Map<string, LatencyOptimizationHeuristic>();
  private readonly optimizationHistory: OptimizationReport[] = [];

  public constructor(budgetController?: BudgetController) {
    this.budgetController = budgetController !== undefined ? budgetController : new BudgetController();
  }

  public getBudgetController(): BudgetController {
    return this.budgetController;
  }

  public registerHeuristic(scenarioId: string, heuristic: LatencyOptimizationHeuristic): void {
    this.heuristics.set(scenarioId, heuristic);
  }

  public computeParetoFrontier(
    candidates: readonly ParetoCandidate[],
    constraints: OptimizationConstraint = {}
  ): ParetoFrontierPoint[] {
    const valid = candidates.filter((c) => this.satisfiesConstraints(c, constraints));
    if (valid.length === 0) return [];

    const sortedCost = [...valid].sort((a, b) => a.estimatedCostUSD - b.estimatedCostUSD);
    const sortedLatency = [...valid].sort((a, b) => a.estimatedLatencyMs - b.estimatedLatencyMs);
    const sortedQuality = [...valid].sort((a, b) => b.expectedQualityScore - a.expectedQualityScore);

    const costRanks = new Map<string, number>();
    const latencyRanks = new Map<string, number>();
    const qualityRanks = new Map<string, number>();

    sortedCost.forEach((c, idx) => costRanks.set(this.candidateKey(c), idx + 1));
    sortedLatency.forEach((c, idx) => latencyRanks.set(this.candidateKey(c), idx + 1));
    sortedQuality.forEach((c, idx) => qualityRanks.set(this.candidateKey(c), idx + 1));

    return valid.map((candidate) => {
      const key = this.candidateKey(candidate);
      let dominanceCount = 0;
      let dominatedByCount = 0;

      for (const other of valid) {
        if (other === candidate) continue;
        if (this.dominates(candidate, other)) dominanceCount += 1;
        if (this.dominates(other, candidate)) dominatedByCount += 1;
      }

      const isParetoOptimal = dominatedByCount === 0;
      const rawC = costRanks.get(key);
      const cRank = rawC !== undefined ? rawC : 1;
      const rawL = latencyRanks.get(key);
      const lRank = rawL !== undefined ? rawL : 1;
      const rawQ = qualityRanks.get(key);
      const qRank = rawQ !== undefined ? rawQ : 1;
      const totalCandidates = valid.length;

      const normCost = cRank / totalCandidates;
      const normLat = lRank / totalCandidates;
      const normQual = (totalCandidates - qRank + 1) / totalCandidates;
      const efficiencyScore = (normQual * 2) / (normCost + normLat + 0.0001);

      return {
        candidate,
        isParetoOptimal,
        dominanceScore: dominanceCount - dominatedByCount,
        efficiencyScore: Math.round(efficiencyScore * 100) / 100,
        costRank: cRank,
        latencyRank: lRank,
        qualityRank: qRank,
      };
    });
  }

  public optimizeScenario(
    scenarioId: string,
    candidates: readonly ParetoCandidate[],
    target: OptimizerTarget = "balanced",
    constraints: OptimizationConstraint = {}
  ): OptimizationReport {
    const frontier = this.computeParetoFrontier(candidates, constraints);
    if (frontier.length === 0) {
      throw new Error(`No viable candidates for scenario ${scenarioId} matching constraints`);
    }

    const optimalPoints = frontier.filter((p) => p.isParetoOptimal);
    const pool = optimalPoints.length > 0 ? optimalPoints : frontier;

    const ranked = [...pool].sort((a, b) => {
      switch (target) {
        case "cost":
          return a.candidate.estimatedCostUSD - b.candidate.estimatedCostUSD;
        case "latency":
          return a.candidate.estimatedLatencyMs - b.candidate.estimatedLatencyMs;
        case "throughput":
          return b.candidate.estimatedTPS - a.candidate.estimatedTPS;
        case "quality":
          return b.candidate.expectedQualityScore - a.candidate.expectedQualityScore;
        case "balanced":
        default:
          return b.efficiencyScore - a.efficiencyScore;
      }
    });

    const primary = ranked[0];
    if (!primary) {
      throw new Error(`No candidate available for target: ${target}`);
    }
    const fallbacks = ranked.slice(1);

    const firstFallback = fallbacks[0];
    const recommendation: ModelRoutingRecommendation = {
      recommendedModel: primary.candidate.modelId,
      recommendedProvider: primary.candidate.providerId,
      fallbackModel: firstFallback !== undefined ? firstFallback.candidate.modelId : undefined,
      fallbackProvider: firstFallback !== undefined ? firstFallback.candidate.providerId : undefined,
      target,
      frontierPoint: primary,
      projectedCostUSD: primary.candidate.estimatedCostUSD,
      projectedLatencyMs: primary.candidate.estimatedLatencyMs,
      rationale: `Selected for ${target} target with efficiency score ${primary.efficiencyScore}`,
    };

    const fallbackChain: ModelRoutingRecommendation[] = fallbacks.map((pt, idx) => {
      const nextFallback = fallbacks[idx + 1];
      return {
        recommendedModel: pt.candidate.modelId,
        recommendedProvider: pt.candidate.providerId,
        fallbackModel: nextFallback !== undefined ? nextFallback.candidate.modelId : undefined,
        fallbackProvider: nextFallback !== undefined ? nextFallback.candidate.providerId : undefined,
        target,
        frontierPoint: pt,
        projectedCostUSD: pt.candidate.estimatedCostUSD,
        projectedLatencyMs: pt.candidate.estimatedLatencyMs,
        rationale: `Fallback priority ${idx + 1} with rank (C:${pt.costRank}, L:${pt.latencyRank}, Q:${pt.qualityRank})`,
      };
    });

    const report: OptimizationReport = {
      scenarioId,
      target,
      constraints,
      candidatesEvaluated: candidates.length,
      paretoFrontier: frontier,
      recommendation,
      fallbackChain,
      timestamp: Date.now(),
    };

    this.optimizationHistory.push(report);
    return report;
  }

  public calculateEfficiencyMetrics(
    totalTokens: number,
    promptTokens: number,
    completionTokens: number,
    totalCostUSD: number,
    cachedPromptTokens: number = 0,
    qualityScore: number = 1.0
  ): CostEfficiencyMetrics {
    const costPerK = totalTokens > 0 ? (totalCostUSD / totalTokens) * 1000 : 0;
    const promptK = promptTokens > 0 ? (totalCostUSD * (promptTokens / totalTokens) / promptTokens) * 1000 : 0;
    const completionK = completionTokens > 0 ? (totalCostUSD * (completionTokens / totalTokens) / completionTokens) * 1000 : 0;
    const cacheRatio = promptTokens > 0 ? cachedPromptTokens / promptTokens : 0;
    const cpRatio = totalCostUSD > 0 ? qualityScore / totalCostUSD : 0;

    return {
      costPerThousandTokensUSD: costPerK,
      promptCostPerThousandUSD: promptK,
      completionCostPerThousandUSD: completionK,
      cacheSavingsRatio: cacheRatio,
      totalSpendUSD: totalCostUSD,
      costPerformanceRatio: cpRatio,
    };
  }

  public getOptimizationHistory(): readonly OptimizationReport[] {
    return this.optimizationHistory;
  }

  public getHeuristic(scenarioId: string): LatencyOptimizationHeuristic | undefined {
    return this.heuristics.get(scenarioId);
  }

  private candidateKey(c: ParetoCandidate): string {
    return `${c.providerId}:${c.modelId}`;
  }

  private satisfiesConstraints(candidate: ParetoCandidate, constraints: OptimizationConstraint): boolean {
    if (constraints.maxCostUSDPerExecution !== undefined && candidate.estimatedCostUSD > constraints.maxCostUSDPerExecution) {
      return false;
    }
    if (constraints.maxTotalLatencyMs !== undefined && candidate.estimatedLatencyMs > constraints.maxTotalLatencyMs) {
      return false;
    }
    if (constraints.minQualityScore !== undefined && candidate.expectedQualityScore < constraints.minQualityScore) {
      return false;
    }
    if (constraints.minTokensPerSecond !== undefined && candidate.estimatedTPS < constraints.minTokensPerSecond) {
      return false;
    }
    if (constraints.maxTTFTMs !== undefined && candidate.estimatedTTFTMs > constraints.maxTTFTMs) {
      return false;
    }
    if (constraints.allowedProviders !== undefined && !constraints.allowedProviders.includes(candidate.providerId)) {
      return false;
    }
    return true;
  }

  private dominates(a: ParetoCandidate, b: ParetoCandidate): boolean {
    const notWorse =
      a.estimatedCostUSD <= b.estimatedCostUSD &&
      a.estimatedLatencyMs <= b.estimatedLatencyMs &&
      a.expectedQualityScore >= b.expectedQualityScore &&
      a.estimatedTPS >= b.estimatedTPS;

    if (!notWorse) return false;
    if (a.estimatedCostUSD < b.estimatedCostUSD) return true;
    if (a.estimatedLatencyMs < b.estimatedLatencyMs) return true;
    if (a.expectedQualityScore > b.expectedQualityScore) return true;
    if (a.estimatedTPS > b.estimatedTPS) return true;
    return false;
  }
}

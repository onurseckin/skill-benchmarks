import type {
  CompositeEvaluationSummary,
  DeterministicSummary,
  EvaluationConfig,
  EvaluationResult,
  JudgeEvaluationResult,
} from "./types.js";

export interface CompositeEvaluationParams {
  readonly scenarioId: string;
  readonly runId: string;
  readonly skillIds: readonly string[];
  readonly modelId: string;
  readonly deterministicSummary?: DeterministicSummary;
  readonly judgeEvaluation?: JudgeEvaluationResult;
  readonly customConfig?: Partial<EvaluationConfig>;
}

export interface AggregatedMatrixResults {
  readonly totalEvaluations: number;
  readonly passedCount: number;
  readonly passRate: number;
  readonly averageCompositeScore: number;
  readonly averageDeterministicScore: number;
  readonly averageJudgeScore: number;
}

export class CompositeEvaluator {
  readonly defaultDeterministicWeight: number = 0.6;
  readonly defaultSemanticWeight: number = 0.4;
  readonly defaultPassScoreThreshold: number = 70;
  readonly defaultRequireAllDeterministicPass: boolean = true;

  constructor(config?: Partial<EvaluationConfig>) {
    if (config?.deterministicWeight !== undefined) {
      this.defaultDeterministicWeight = config.deterministicWeight;
    }
    if (config?.semanticWeight !== undefined) {
      this.defaultSemanticWeight = config.semanticWeight;
    }
    if (config?.passScoreThreshold !== undefined) {
      this.defaultPassScoreThreshold = config.passScoreThreshold;
    }
    if (config?.requireAllDeterministicPass !== undefined) {
      this.defaultRequireAllDeterministicPass = config.requireAllDeterministicPass;
    }
  }

  evaluate(params: CompositeEvaluationParams): CompositeEvaluationSummary {
    const deterministicWeight = params.customConfig?.deterministicWeight ?? this.defaultDeterministicWeight;
    const semanticWeight = params.customConfig?.semanticWeight ?? this.defaultSemanticWeight;
    const passScoreThreshold = params.customConfig?.passScoreThreshold ?? this.defaultPassScoreThreshold;
    const requireAllDeterministicPass = params.customConfig?.requireAllDeterministicPass ?? this.defaultRequireAllDeterministicPass;

    let compositeScore = 0;
    const hasDeterministic = params.deterministicSummary !== undefined;
    const hasJudge = params.judgeEvaluation !== undefined;

    if (hasDeterministic && hasJudge) {
      const totalWeight = deterministicWeight + semanticWeight;
      const detScore = params.deterministicSummary?.weightedScore ?? 0;
      const judgeScore = params.judgeEvaluation?.overallScore ?? 0;
      compositeScore = totalWeight > 0
        ? (detScore * deterministicWeight + judgeScore * semanticWeight) / totalWeight
        : (detScore + judgeScore) / 2;
    } else if (hasDeterministic) {
      compositeScore = params.deterministicSummary?.weightedScore ?? 0;
    } else if (hasJudge) {
      compositeScore = params.judgeEvaluation?.overallScore ?? 0;
    }

    const finalCompositeScore = Math.max(0, Math.min(100, Math.round(compositeScore * 100) / 100));

    let passed = finalCompositeScore >= passScoreThreshold;
    if (requireAllDeterministicPass && params.deterministicSummary !== undefined) {
      passed = passed && params.deterministicSummary.allPassed;
    }

    return {
      scenarioId: params.scenarioId,
      runId: params.runId,
      skillIds: params.skillIds,
      modelId: params.modelId,
      passed,
      compositeScore: finalCompositeScore,
      deterministicSummary: params.deterministicSummary,
      judgeEvaluation: params.judgeEvaluation,
      deterministicWeight,
      semanticWeight,
      passScoreThreshold,
      evaluatedAt: new Date().toISOString(),
    };
  }

  evaluateFullResult(params: CompositeEvaluationParams): EvaluationResult {
    const compositeSummary = this.evaluate(params);
    return {
      scenarioId: params.scenarioId,
      runId: params.runId,
      success: compositeSummary.passed,
      compositeSummary,
      deterministicSummary: params.deterministicSummary,
      judgeEvaluation: params.judgeEvaluation,
    };
  }

  static aggregateMatrixResults(
    results: readonly CompositeEvaluationSummary[]
  ): AggregatedMatrixResults {
    const totalEvaluations = results.length;
    if (totalEvaluations === 0) {
      return {
        totalEvaluations: 0,
        passedCount: 0,
        passRate: 0,
        averageCompositeScore: 0,
        averageDeterministicScore: 0,
        averageJudgeScore: 0,
      };
    }

    const passedCount = results.filter((r) => r.passed).length;
    const passRate = Math.round((passedCount / totalEvaluations) * 10000) / 100;
    const totalCompositeScore = results.reduce((acc, r) => acc + r.compositeScore, 0);
    const averageCompositeScore = Math.round((totalCompositeScore / totalEvaluations) * 100) / 100;

    const detResults = results.filter((r) => r.deterministicSummary !== undefined);
    const averageDeterministicScore = detResults.length > 0
      ? Math.round(
          (detResults.reduce((acc, r) => acc + (r.deterministicSummary?.weightedScore ?? 0), 0) / detResults.length) * 100
        ) / 100
      : 0;

    const judgeResults = results.filter((r) => r.judgeEvaluation !== undefined);
    const averageJudgeScore = judgeResults.length > 0
      ? Math.round(
          (judgeResults.reduce((acc, r) => acc + (r.judgeEvaluation?.overallScore ?? 0), 0) / judgeResults.length) * 100
        ) / 100
      : 0;

    return {
      totalEvaluations,
      passedCount,
      passRate,
      averageCompositeScore,
      averageDeterministicScore,
      averageJudgeScore,
    };
  }
}

export function evaluateCompositeScenario(
  params: CompositeEvaluationParams
): CompositeEvaluationSummary {
  const evaluator = new CompositeEvaluator(params.customConfig);
  return evaluator.evaluate(params);
}

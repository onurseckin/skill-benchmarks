import type { BenchmarkIneligibilityReason } from "../shared/benchmark-authority.js";
import { createDeterministicEvidenceDigest } from "./deterministic.js";
import type {
  CompositeEvaluationSummary,
  DeterministicSummary,
  EvaluatedDeterministicSummary,
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

interface ResolvedEvaluationConfig {
  readonly deterministicWeight: number;
  readonly semanticWeight: number;
  readonly passScoreThreshold: number;
  readonly requireAllDeterministicPass: boolean;
}

export class CompositeEvaluator {
  public readonly defaultDeterministicWeight: number;
  public readonly defaultSemanticWeight: number;
  public readonly defaultPassScoreThreshold: number;
  public readonly defaultRequireAllDeterministicPass: boolean;

  public constructor(config?: Partial<EvaluationConfig>) {
    this.defaultDeterministicWeight = config?.deterministicWeight ?? 0.6;
    this.defaultSemanticWeight = config?.semanticWeight ?? 0.4;
    this.defaultPassScoreThreshold = config?.passScoreThreshold ?? 70;
    this.defaultRequireAllDeterministicPass = config?.requireAllDeterministicPass ?? true;
  }

  public evaluate(params: CompositeEvaluationParams): CompositeEvaluationSummary {
    const identity = {
      scenarioId: params.scenarioId,
      runId: params.runId,
      skillIds: params.skillIds,
      modelId: params.modelId,
      ...(params.deterministicSummary === undefined ? {} : { deterministicSummary: params.deterministicSummary }),
      ...(params.judgeEvaluation === undefined ? {} : { judgeEvaluation: params.judgeEvaluation }),
    };
    if (params.deterministicSummary === undefined) {
      const reason = params.judgeEvaluation === undefined ? "evaluation_missing" : "no_required_checks";
      return { ...identity, status: "not_evaluated", reasons: [reason] };
    }
    if (params.deterministicSummary?.status === "not_evaluated") {
      return { ...identity, status: "not_evaluated", reasons: params.deterministicSummary.reasons };
    }
    if (params.deterministicSummary?.status === "invalid") {
      return { ...identity, status: "invalid", reasons: params.deterministicSummary.reasons };
    }
    const config = this.resolveConfig(params.customConfig);
    const invalidReason = validateInputs(params, config);
    if (invalidReason !== undefined) return { ...identity, status: "invalid", reasons: [invalidReason] };
    const deterministicScore = params.deterministicSummary?.status === "evaluated"
      ? params.deterministicSummary.score
      : undefined;
    const judgeScore = params.judgeEvaluation?.overallScore;
    const compositeScore = calculateCompositeScore(
      deterministicScore,
      judgeScore,
      config.deterministicWeight,
      config.semanticWeight
    );
    const deterministicPassed = params.deterministicSummary?.status === "evaluated"
      ? params.deterministicSummary.passed
      : true;
    const passed = compositeScore >= config.passScoreThreshold
      && (!config.requireAllDeterministicPass || deterministicPassed);
    return {
      ...identity,
      status: "evaluated",
      passed,
      compositeScore,
      ...config,
      evaluatedAt: new Date().toISOString(),
    };
  }

  public evaluateFullResult(params: CompositeEvaluationParams): EvaluationResult {
    return {
      scenarioId: params.scenarioId,
      runId: params.runId,
      compositeSummary: this.evaluate(params),
      ...(params.deterministicSummary === undefined ? {} : { deterministicSummary: params.deterministicSummary }),
      ...(params.judgeEvaluation === undefined ? {} : { judgeEvaluation: params.judgeEvaluation }),
    };
  }

  private resolveConfig(customConfig: Partial<EvaluationConfig> | undefined): ResolvedEvaluationConfig {
    return {
      deterministicWeight: customConfig?.deterministicWeight ?? this.defaultDeterministicWeight,
      semanticWeight: customConfig?.semanticWeight ?? this.defaultSemanticWeight,
      passScoreThreshold: customConfig?.passScoreThreshold ?? this.defaultPassScoreThreshold,
      requireAllDeterministicPass: customConfig?.requireAllDeterministicPass ?? this.defaultRequireAllDeterministicPass,
    };
  }
}

export function evaluateCompositeScenario(params: CompositeEvaluationParams): CompositeEvaluationSummary {
  return new CompositeEvaluator(params.customConfig).evaluate(params);
}

function validateInputs(
  params: CompositeEvaluationParams,
  config: ResolvedEvaluationConfig
): BenchmarkIneligibilityReason | undefined {
  if (
    !finiteNonnegative(config.deterministicWeight)
    || !finiteNonnegative(config.semanticWeight)
    || config.deterministicWeight + config.semanticWeight <= 0
    || typeof config.requireAllDeterministicPass !== "boolean"
  ) return "evidence_invalid";
  if (!finiteRange(config.passScoreThreshold, 0, 100)) return "score_invalid";
  if (params.deterministicSummary?.status === "evaluated") {
    const deterministicReason = validateEvaluatedDeterministicSummary(params.deterministicSummary);
    if (deterministicReason !== undefined) return deterministicReason;
  }
  if (params.judgeEvaluation !== undefined && !finiteRange(params.judgeEvaluation.overallScore, 0, 100)) return "score_invalid";
  return undefined;
}

export function validateEvaluatedDeterministicSummary(
  summary: EvaluatedDeterministicSummary
): BenchmarkIneligibilityReason | undefined {
  if (!finiteRange(summary.score, 0, 100)) return "score_invalid";
  if (
    typeof summary.passed !== "boolean"
    || !Array.isArray(summary.checkResults)
    || typeof summary.evidenceDigest !== "string"
    || !Number.isInteger(summary.totalChecksCount)
    || summary.totalChecksCount < 1
    || !Number.isInteger(summary.passedChecksCount)
    || summary.passedChecksCount < 0
    || summary.passedChecksCount > summary.totalChecksCount
    || summary.checkResults.length !== summary.totalChecksCount
    || summary.evidenceDigest.trim().length === 0
    || summary.evidenceDigest !== createDeterministicEvidenceDigest(summary.checkResults)
  ) return "evidence_invalid";
  const identifiers = new Set<string>();
  let weightedScore = 0;
  let totalWeight = 0;
  for (const result of summary.checkResults) {
    if (
      typeof result.checkId !== "string"
      || result.checkId.trim().length === 0
      || identifiers.has(result.checkId)
      || typeof result.passed !== "boolean"
      || !finiteRange(result.score, 0, 1)
      || !Number.isFinite(result.weight)
      || result.weight <= 0
      || result.weightedScore !== result.score * result.weight
    ) return "evidence_invalid";
    identifiers.add(result.checkId);
    weightedScore += result.weightedScore;
    totalWeight += result.weight;
  }
  const passedCount = summary.checkResults.filter((result) => result.passed).length;
  const expectedScore = Math.round((weightedScore / totalWeight) * 10000) / 100;
  if (summary.passedChecksCount !== passedCount || summary.passed !== (passedCount === summary.totalChecksCount)) return "pass_inconsistent";
  return summary.score === expectedScore ? undefined : "score_invalid";
}

function calculateCompositeScore(
  deterministicScore: number | undefined,
  judgeScore: number | undefined,
  deterministicWeight: number,
  semanticWeight: number
): number {
  if (deterministicScore !== undefined && judgeScore !== undefined) {
    return round((deterministicScore * deterministicWeight + judgeScore * semanticWeight) / (deterministicWeight + semanticWeight));
  }
  return round(deterministicScore ?? judgeScore ?? Number.NaN);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function finiteRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function finiteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

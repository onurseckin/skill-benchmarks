import { randomUUID } from "node:crypto";
import { BradleyTerryScorer } from "./bradley-terry.js";
import type {
  ConsensusEvaluationResult,
  DebiasedPairwiseAssessment,
  JudgeModelConfig,
  JudgeVerdict,
  ModelOutput,
  MultiModelJudgeConfig,
  PairwiseEvaluationPrompt,
  PairwiseMatchOutcome,
  PositionBiasType,
  SingleJudgeEvaluation,
} from "./types.js";

function getSafeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value;
  }
  return fallback;
}

export class MultiModelJudgeEngine {
  public readonly config: MultiModelJudgeConfig;
  public readonly bradleyTerry: BradleyTerryScorer;

  public constructor(config?: MultiModelJudgeConfig) {
    if (config !== undefined) {
      this.config = config;
    } else {
      this.config = {
        judges: [
          { id: "judge-default-1", name: "Consensus Judge Alpha", weight: 1.0 },
          { id: "judge-default-2", name: "Consensus Judge Beta", weight: 1.0 },
          { id: "judge-default-3", name: "Consensus Judge Gamma", weight: 1.0 },
        ],
        debiasPosition: true,
        tieThreshold: 0.05,
        minConsensusAgreement: 0.6,
      };
    }
    this.bradleyTerry = new BradleyTerryScorer();
  }

  public async evaluatePairwise(
    prompt: PairwiseEvaluationPrompt,
    outputA: ModelOutput,
    outputB: ModelOutput
  ): Promise<ConsensusEvaluationResult> {
    const startTime = Date.now();
    const debias = this.config.debiasPosition !== false;
    const judgments: SingleJudgeEvaluation[] = [];
    const debiasedAssessments: DebiasedPairwiseAssessment[] = [];

    for (const judge of this.config.judges) {
      const forwardResult = await this.invokeJudge(
        judge,
        prompt,
        outputA.content,
        outputB.content,
        outputA.modelId,
        outputB.modelId,
        "forward"
      );
      judgments.push(forwardResult);

      let reverseResult: SingleJudgeEvaluation | undefined = undefined;
      if (debias) {
        reverseResult = await this.invokeJudge(
          judge,
          prompt,
          outputB.content,
          outputA.content,
          outputB.modelId,
          outputA.modelId,
          "reversed"
        );
        judgments.push(reverseResult);
      }

      const assessment = this.reconcileJudgeEvaluations(
        judge.id,
        prompt.promptId,
        outputA.modelId,
        outputB.modelId,
        forwardResult,
        reverseResult
      );
      debiasedAssessments.push(assessment);
    }

    return this.aggregateConsensus(
      prompt.promptId,
      outputA.modelId,
      outputB.modelId,
      judgments,
      debiasedAssessments,
      startTime
    );
  }

  public async evaluateAllPairs(
    prompts: readonly PairwiseEvaluationPrompt[],
    outputsByModel: Readonly<Record<string, readonly ModelOutput[]>>
  ): Promise<readonly PairwiseMatchOutcome[]> {
    const models = Object.keys(outputsByModel);
    const outcomes: PairwiseMatchOutcome[] = [];

    for (const prompt of prompts) {
      for (let i = 0; i < models.length; i++) {
        for (let j = i + 1; j < models.length; j++) {
          const rawA = models[i];
          const rawB = models[j];
          const modelA = typeof rawA === "string" ? rawA : "";
          const modelB = typeof rawB === "string" ? rawB : "";
          const rawListA = outputsByModel[modelA];
          const rawListB = outputsByModel[modelB];
          const outListA = Array.isArray(rawListA) ? rawListA : [];
          const outListB = Array.isArray(rawListB) ? rawListB : [];

          const outA = outListA.find((o) => o.modelId === modelA);
          const outB = outListB.find((o) => o.modelId === modelB);

          if (outA === undefined) {
            continue;
          }
          if (outB === undefined) {
            continue;
          }

          const consensus = await this.evaluatePairwise(prompt, outA, outB);
          outcomes.push({
            matchId: randomUUID(),
            promptId: prompt.promptId,
            modelA,
            modelB,
            winner: consensus.consensusWinner,
            scoreA: consensus.meanScoreA,
            scoreB: consensus.meanScoreB,
            weight: 1.0,
            confidence: consensus.consensusConfidence,
            rationale: `Consensus agreement ${consensus.agreementRatio * 100}% across ${this.config.judges.length} judges`,
          });
        }
      }
    }

    return outcomes;
  }

  private async invokeJudge(
    judge: JudgeModelConfig,
    prompt: PairwiseEvaluationPrompt,
    text1: string,
    text2: string,
    model1: string,
    model2: string,
    order: "forward" | "reversed"
  ): Promise<SingleJudgeEvaluation> {
    const start = Date.now();
    if (this.config.callJudge !== undefined) {
      const res = await this.config.callJudge(judge, prompt.prompt, text1, text2, prompt.rubric);
      let mappedWinner: JudgeVerdict = "tie";
      if (res.winner === "model_a") {
        mappedWinner = order === "forward" ? "model_a" : "model_b";
      } else if (res.winner === "model_b") {
        mappedWinner = order === "forward" ? "model_b" : "model_a";
      }

      return {
        evaluationId: randomUUID(),
        judgeId: judge.id,
        promptId: prompt.promptId,
        modelA: order === "forward" ? model1 : model2,
        modelB: order === "forward" ? model2 : model1,
        presentationOrder: order,
        winner: mappedWinner,
        scoreA: order === "forward" ? res.scoreA : res.scoreB,
        scoreB: order === "forward" ? res.scoreB : res.scoreA,
        confidence: res.confidence,
        rationale: res.rationale,
        evaluationTimeMs: Date.now() - start,
        tokenUsage: res.tokenUsage,
      };
    }

    return this.heuristicJudgeEvaluate(judge, prompt, text1, text2, model1, model2, order, start);
  }

  private heuristicJudgeEvaluate(
    judge: JudgeModelConfig,
    prompt: PairwiseEvaluationPrompt,
    text1: string,
    text2: string,
    model1: string,
    model2: string,
    order: "forward" | "reversed",
    start: number
  ): SingleJudgeEvaluation {
    const len1 = text1.trim().length;
    const len2 = text2.trim().length;
    const score1 = Math.min(1.0, 0.5 + Math.tanh(len1 / 500) * 0.45);
    const score2 = Math.min(1.0, 0.5 + Math.tanh(len2 / 500) * 0.45);
    const diff = score1 - score2;

    const threshold = getSafeNumber(this.config.tieThreshold, 0.05);
    let localWinner: JudgeVerdict = "tie";
    if (diff > threshold) {
      localWinner = "model_a";
    } else if (diff < -threshold) {
      localWinner = "model_b";
    }

    let mappedWinner: JudgeVerdict = "tie";
    if (localWinner === "model_a") {
      mappedWinner = order === "forward" ? "model_a" : "model_b";
    } else if (localWinner === "model_b") {
      mappedWinner = order === "forward" ? "model_b" : "model_a";
    }

    const sA = order === "forward" ? score1 : score2;
    const sB = order === "forward" ? score2 : score1;
    const confidence = Math.min(1.0, 0.7 + Math.abs(diff));

    return {
      evaluationId: randomUUID(),
      judgeId: judge.id,
      promptId: prompt.promptId,
      modelA: order === "forward" ? model1 : model2,
      modelB: order === "forward" ? model2 : model1,
      presentationOrder: order,
      winner: mappedWinner,
      scoreA: Math.round(sA * 1000) / 1000,
      scoreB: Math.round(sB * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      rationale: `Heuristic evaluation based on response completeness for ${judge.name}.`,
      evaluationTimeMs: Date.now() - start,
    };
  }

  private reconcileJudgeEvaluations(
    judgeId: string,
    promptId: string,
    modelA: string,
    modelB: string,
    forward: SingleJudgeEvaluation,
    reverse?: SingleJudgeEvaluation
  ): DebiasedPairwiseAssessment {
    if (reverse === undefined) {
      return {
        promptId,
        modelA,
        modelB,
        forwardWinner: forward.winner,
        reverseWinner: forward.winner,
        reconciledWinner: forward.winner,
        scoreA: forward.scoreA,
        scoreB: forward.scoreB,
        confidence: forward.confidence,
        positionBiasDetected: false,
        positionBiasType: "none",
        judgeId,
      };
    }

    const forwardWinner = forward.winner;
    const reverseWinner = reverse.winner;

    let positionBiasDetected = false;
    let positionBiasType: PositionBiasType = "none";
    let reconciledWinner: JudgeVerdict = "tie";

    if (forwardWinner === reverseWinner) {
      reconciledWinner = forwardWinner;
    } else if (forwardWinner === "model_a" && reverseWinner === "model_b") {
      positionBiasDetected = true;
      positionBiasType = "first_position_bias";
      reconciledWinner = "tie";
    } else if (forwardWinner === "model_b" && reverseWinner === "model_a") {
      positionBiasDetected = true;
      positionBiasType = "second_position_bias";
      reconciledWinner = "tie";
    } else {
      positionBiasDetected = true;
      positionBiasType = "inconsistent";
      reconciledWinner = forwardWinner !== "tie" ? forwardWinner : reverseWinner;
    }

    const meanA = (forward.scoreA + reverse.scoreA) / 2;
    const meanB = (forward.scoreB + reverse.scoreB) / 2;
    const biasPenalty = positionBiasDetected ? 0.7 : 1.0;
    const combinedConfidence = ((forward.confidence + reverse.confidence) / 2) * biasPenalty;

    return {
      promptId,
      modelA,
      modelB,
      forwardWinner,
      reverseWinner,
      reconciledWinner,
      scoreA: Math.round(meanA * 1000) / 1000,
      scoreB: Math.round(meanB * 1000) / 1000,
      confidence: Math.round(combinedConfidence * 1000) / 1000,
      positionBiasDetected,
      positionBiasType,
      judgeId,
    };
  }

  private aggregateConsensus(
    promptId: string,
    modelA: string,
    modelB: string,
    judgments: readonly SingleJudgeEvaluation[],
    assessments: readonly DebiasedPairwiseAssessment[],
    startTime: number
  ): ConsensusEvaluationResult {
    void startTime;
    let votesA = 0;
    let votesB = 0;
    let votesTie = 0;
    let totalWeight = 0;
    let weightedScoreA = 0;
    let weightedScoreB = 0;
    let weightedConfidence = 0;
    let biasCount = 0;

    for (const assessment of assessments) {
      const judge = this.config.judges.find((j) => j.id === assessment.judgeId);
      const weight = getSafeNumber(judge?.weight, 1.0);

      totalWeight += weight;
      weightedScoreA += assessment.scoreA * weight;
      weightedScoreB += assessment.scoreB * weight;
      weightedConfidence += assessment.confidence * weight;

      if (assessment.positionBiasDetected) {
        biasCount++;
      }

      if (assessment.reconciledWinner === "model_a") {
        votesA += weight;
      } else if (assessment.reconciledWinner === "model_b") {
        votesB += weight;
      } else {
        votesTie += weight;
      }
    }

    const effectiveWeight = totalWeight > 0 ? totalWeight : 1.0;
    const meanA = weightedScoreA / effectiveWeight;
    const meanB = weightedScoreB / effectiveWeight;
    const meanConfidence = weightedConfidence / effectiveWeight;

    let consensusWinner: JudgeVerdict = "tie";
    let dominantVotes = votesTie;

    if (votesA > votesB && votesA > votesTie) {
      consensusWinner = "model_a";
      dominantVotes = votesA;
    } else if (votesB > votesA && votesB > votesTie) {
      consensusWinner = "model_b";
      dominantVotes = votesB;
    }

    const agreementRatio = dominantVotes / effectiveWeight;
    const positionBiasRate = assessments.length > 0 ? biasCount / assessments.length : 0;

    return {
      promptId,
      modelA,
      modelB,
      consensusWinner,
      meanScoreA: Math.round(meanA * 1000) / 1000,
      meanScoreB: Math.round(meanB * 1000) / 1000,
      consensusConfidence: Math.round(meanConfidence * 1000) / 1000,
      agreementRatio: Math.round(agreementRatio * 1000) / 1000,
      positionBiasRate: Math.round(positionBiasRate * 1000) / 1000,
      judgments,
      debiasedAssessments: assessments,
      timestamp: Date.now(),
    };
  }
}

export function createMultiModelJudge(config?: MultiModelJudgeConfig): MultiModelJudgeEngine {
  return new MultiModelJudgeEngine(config);
}

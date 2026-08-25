import { BradleyTerryScorer, createBradleyTerryScorer } from "./bradley-terry.js";
import { MultiModelJudgeEngine, createMultiModelJudge } from "./judge-engine.js";
import type {
  BradleyTerryConfig,
  BradleyTerryResult,
  ConsensusEvaluationResult,
  JudgeArenaLeaderboard,
  JudgeArenaOptions,
  ModelOutput,
  MultiModelJudgeConfig,
  PairwiseEvaluationPrompt,
  PairwiseMatchOutcome,
  SkillRating,
} from "./types.js";

export * from "./types.js";
export * from "./bradley-terry.js";
export * from "./judge-engine.js";

export class JudgeArena {
  public readonly judgeEngine: MultiModelJudgeEngine;
  public readonly bradleyTerry: BradleyTerryScorer;

  public constructor(options?: JudgeArenaOptions) {
    this.judgeEngine = new MultiModelJudgeEngine(options?.judgeConfig);
    this.bradleyTerry = new BradleyTerryScorer();
  }

  public async evaluatePairwise(
    prompt: PairwiseEvaluationPrompt,
    outputA: ModelOutput,
    outputB: ModelOutput
  ): Promise<ConsensusEvaluationResult> {
    return this.judgeEngine.evaluatePairwise(prompt, outputA, outputB);
  }

  public async evaluateAllPairs(
    prompts: readonly PairwiseEvaluationPrompt[],
    outputsByModel: Readonly<Record<string, readonly ModelOutput[]>>
  ): Promise<readonly PairwiseMatchOutcome[]> {
    return this.judgeEngine.evaluateAllPairs(prompts, outputsByModel);
  }

  public scoreMatches(
    matches: readonly PairwiseMatchOutcome[],
    config?: BradleyTerryConfig
  ): BradleyTerryResult {
    return this.bradleyTerry.fit(matches, config);
  }

  public async evaluateAndRank(
    prompts: readonly PairwiseEvaluationPrompt[],
    outputsByModel: Readonly<Record<string, readonly ModelOutput[]>>,
    options?: {
      readonly judgeConfig?: MultiModelJudgeConfig;
      readonly bradleyTerryConfig?: BradleyTerryConfig;
    }
  ): Promise<JudgeArenaLeaderboard> {
    const matches = await this.evaluateAllPairs(prompts, outputsByModel);
    const btResult = this.scoreMatches(matches, options?.bradleyTerryConfig);

    let totalJudgments = 0;
    for (const match of matches) {
      if (typeof match.weight === "number") {
        totalJudgments += match.weight;
      }
    }

    return {
      updatedAt: Date.now(),
      totalJudgments,
      totalPairwiseMatches: matches.length,
      positionBiasRate: 0,
      ratings: btResult.ratings,
      matrix: btResult.matrix,
    };
  }

  public getModelRankings(
    matches: readonly PairwiseMatchOutcome[],
    config?: BradleyTerryConfig
  ): readonly SkillRating[] {
    const result = this.scoreMatches(matches, config);
    return result.ratings;
  }
}

export function createJudgeArena(options?: JudgeArenaOptions): JudgeArena {
  return new JudgeArena(options);
}

export default createJudgeArena;

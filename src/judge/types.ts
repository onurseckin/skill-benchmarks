export type JudgeVerdict = "model_a" | "model_b" | "tie";

export type PositionOrder = "forward" | "reversed";

export type PositionBiasType =
  | "first_position_bias"
  | "second_position_bias"
  | "inconsistent"
  | "none";

export type TieBreakingStrategy =
  | "random"
  | "higher_confidence"
  | "length_penalty"
  | "half_win"
  | "strict_draw";

export interface ConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
  readonly confidenceLevel: number;
  readonly marginOfError: number;
}

export interface PairwiseMatchOutcome {
  readonly matchId: string;
  readonly promptId: string;
  readonly modelA: string;
  readonly modelB: string;
  readonly winner: JudgeVerdict;
  readonly scoreA: number;
  readonly scoreB: number;
  readonly weight: number;
  readonly confidence: number;
  readonly rationale?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PairwiseMatchMatrix {
  readonly models: readonly string[];
  readonly wins: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly ties: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly totalMatches: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly totalPairwiseCount: number;
}

export interface BradleyTerryConfig {
  readonly maxIterations?: number;
  readonly tolerance?: number;
  readonly priorWeight?: number;
  readonly baseElo?: number;
  readonly eloScale?: number;
  readonly tieWeight?: number;
  readonly baselineModel?: string;
  readonly computeConfidenceIntervals?: boolean;
  readonly confidenceLevel?: number;
}

export interface SkillRating {
  readonly modelId: string;
  readonly skill: number;
  readonly standardError: number;
  readonly confidenceInterval: ConfidenceInterval;
  readonly elo: number;
  readonly eloLower: number;
  readonly eloUpper: number;
  readonly rank: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly totalMatches: number;
  readonly winRate: number;
}

export interface BradleyTerryResult {
  readonly ratings: readonly SkillRating[];
  readonly iterations: number;
  readonly converged: boolean;
  readonly logLikelihood: number;
  readonly aic: number;
  readonly bic: number;
  readonly baselineModel: string;
  readonly matrix: PairwiseMatchMatrix;
  readonly executionTimeMs: number;
}

export interface JudgeModelConfig {
  readonly id: string;
  readonly name: string;
  readonly weight?: number;
  readonly temperature?: number;
  readonly systemPrompt?: string;
  readonly providerId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TokenUsageStats {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ModelOutput {
  readonly modelId: string;
  readonly content: string;
  readonly latencyMs?: number;
  readonly tokenUsage?: TokenUsageStats;
}

export interface PairwiseEvaluationPrompt {
  readonly promptId: string;
  readonly prompt: string;
  readonly rubric?: string;
  readonly criteria?: readonly string[];
  readonly referenceAnswer?: string;
  readonly systemContext?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SingleJudgeEvaluation {
  readonly evaluationId: string;
  readonly judgeId: string;
  readonly promptId: string;
  readonly modelA: string;
  readonly modelB: string;
  readonly presentationOrder: PositionOrder;
  readonly winner: JudgeVerdict;
  readonly scoreA: number;
  readonly scoreB: number;
  readonly confidence: number;
  readonly rationale: string;
  readonly evaluationTimeMs: number;
  readonly tokenUsage?: TokenUsageStats;
}

export interface DebiasedPairwiseAssessment {
  readonly promptId: string;
  readonly modelA: string;
  readonly modelB: string;
  readonly forwardWinner: JudgeVerdict;
  readonly reverseWinner: JudgeVerdict;
  readonly reconciledWinner: JudgeVerdict;
  readonly scoreA: number;
  readonly scoreB: number;
  readonly confidence: number;
  readonly positionBiasDetected: boolean;
  readonly positionBiasType: PositionBiasType;
  readonly judgeId: string;
}

export interface ConsensusEvaluationResult {
  readonly promptId: string;
  readonly modelA: string;
  readonly modelB: string;
  readonly consensusWinner: JudgeVerdict;
  readonly meanScoreA: number;
  readonly meanScoreB: number;
  readonly consensusConfidence: number;
  readonly agreementRatio: number;
  readonly positionBiasRate: number;
  readonly judgments: readonly SingleJudgeEvaluation[];
  readonly debiasedAssessments: readonly DebiasedPairwiseAssessment[];
  readonly timestamp: number;
}

export interface MultiModelJudgeConfig {
  readonly judges: readonly JudgeModelConfig[];
  readonly debiasPosition?: boolean;
  readonly tieThreshold?: number;
  readonly minConsensusAgreement?: number;
  readonly defaultRubric?: string;
  readonly tieBreakingStrategy?: TieBreakingStrategy;
  readonly callJudge?: (
    judge: JudgeModelConfig,
    prompt: string,
    responseA: string,
    responseB: string,
    rubric?: string
  ) => Promise<{
    readonly winner: JudgeVerdict;
    readonly scoreA: number;
    readonly scoreB: number;
    readonly confidence: number;
    readonly rationale: string;
    readonly tokenUsage?: TokenUsageStats;
  }>;
}

export interface JudgeArenaOptions {
  readonly judgeConfig?: MultiModelJudgeConfig;
  readonly bradleyTerryConfig?: BradleyTerryConfig;
}

export interface JudgeArenaLeaderboard {
  readonly updatedAt: number;
  readonly totalJudgments: number;
  readonly totalPairwiseMatches: number;
  readonly positionBiasRate: number;
  readonly ratings: readonly SkillRating[];
  readonly matrix: PairwiseMatchMatrix;
}

export type ArenaModelRole =
  | "proposer"
  | "critic"
  | "rebuttal"
  | "juror"
  | "moderator";

export type DebateTurnType =
  | "proposal"
  | "critique"
  | "rebuttal"
  | "cross_examination"
  | "closing_statement";

export type DebateCritiqueSeverity =
  | "critical"
  | "major"
  | "minor"
  | "neutral"
  | "praise";

export type DebateTranscriptStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "timed_out"
  | "failed"
  | "aborted";

export type JurorVerdict =
  | "accept"
  | "reject"
  | "revise"
  | "inconclusive";

export type ConsensusVerdict =
  | "unanimous"
  | "supermajority"
  | "simple_majority"
  | "split"
  | "hung_jury";

export type ConsensusAggregationMethod =
  | "bayesian_mean"
  | "trimmed_mean"
  | "confidence_weighted"
  | "median";

export type OutlierDetectionMethod =
  | "z_score"
  | "iqr"
  | "modified_z_score"
  | "none";

export interface ArenaModelParticipant {
  readonly id: string;
  readonly name: string;
  readonly role: ArenaModelRole;
  readonly modelId: string;
  readonly providerId?: string;
  readonly temperature?: number;
  readonly systemPrompt?: string;
  readonly biasWeight?: number;
  readonly historicalElo?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ArenaRubricDimension {
  readonly name: string;
  readonly weight: number;
  readonly minScore: number;
  readonly maxScore: number;
  readonly category?: string;
  readonly description?: string;
  readonly criteria?: Readonly<Record<number, string>>;
}

export interface DebateProtocolConfig {
  readonly topic: string;
  readonly scenarioId?: string;
  readonly maxRounds: number;
  readonly roundTimeoutMs?: number;
  readonly proposerModel: ArenaModelParticipant;
  readonly criticModels: readonly ArenaModelParticipant[];
  readonly juryModels: readonly ArenaModelParticipant[];
  readonly allowRebuttals?: boolean;
  readonly crossExaminationRounds?: number;
  readonly consensusThreshold?: number;
  readonly rubricDimensions?: readonly ArenaRubricDimension[];
  readonly systemContext?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DebateCritiquePoint {
  readonly id: string;
  readonly dimension: string;
  readonly severity: DebateCritiqueSeverity;
  readonly claim: string;
  readonly counterArgument?: string;
  readonly rebuttalAnswer?: string;
  readonly isResolved?: boolean;
}

export interface DebateTurnTokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface DebateTurn {
  readonly turnId: string;
  readonly roundNumber: number;
  readonly turnType: DebateTurnType;
  readonly author: ArenaModelParticipant;
  readonly targetTurnId?: string;
  readonly targetAuthorId?: string;
  readonly content: string;
  readonly timestamp: number;
  readonly critiquePoints?: readonly DebateCritiquePoint[];
  readonly confidenceScore?: number;
  readonly executionTimeMs?: number;
  readonly tokenUsage?: DebateTurnTokenUsage;
}

export interface DebateRound {
  readonly roundNumber: number;
  readonly turns: readonly DebateTurn[];
  readonly startedAt: number;
  readonly completedAt: number;
  readonly summary?: string;
}

export interface DebateTranscript {
  readonly debateId: string;
  readonly config: DebateProtocolConfig;
  readonly rounds: readonly DebateRound[];
  readonly status: DebateTranscriptStatus;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly totalTurns: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface JurorDimensionScore {
  readonly dimension: string;
  readonly score: number;
  readonly normalizedScore: number;
  readonly confidence: number;
  readonly rationale: string;
  readonly strengths?: readonly string[];
  readonly weaknesses?: readonly string[];
}

export interface JurorEvaluation {
  readonly jurorId: string;
  readonly modelId: string;
  readonly scores: readonly JurorDimensionScore[];
  readonly overallScore: number;
  readonly winner?: string;
  readonly verdict: JurorVerdict;
  readonly confidence: number;
  readonly dissentingReason?: string;
  readonly evaluationTimeMs?: number;
  readonly tokenUsage?: DebateTurnTokenUsage;
}

export interface ConsensusConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
  readonly confidenceLevel: number;
}

export interface ConsensusScoreDimensionSummary {
  readonly dimension: string;
  readonly meanScore: number;
  readonly weightedScore: number;
  readonly confidenceInterval: ConsensusConfidenceInterval;
  readonly variance: number;
  readonly stdDev: number;
}

export interface OutlierJurorReport {
  readonly jurorId: string;
  readonly modelId: string;
  readonly zScore: number;
  readonly deviationFromMean: number;
  readonly detectedMethod: OutlierDetectionMethod;
  readonly isExcluded: boolean;
  readonly discountFactor: number;
}

export interface ConsensusDissentingOpinion {
  readonly jurorId: string;
  readonly modelId: string;
  readonly reason: string;
  readonly proposedVerdict?: JurorVerdict;
}

export interface ConsensusArbitrationResult {
  readonly debateId: string;
  readonly verdict: ConsensusVerdict;
  readonly winningParticipantId?: string;
  readonly aggregationMethod: ConsensusAggregationMethod;
  readonly overallScore: number;
  readonly overallConfidence: number;
  readonly dimensionSummaries: readonly ConsensusScoreDimensionSummary[];
  readonly jurorEvaluations: readonly JurorEvaluation[];
  readonly outlierReports: readonly OutlierJurorReport[];
  readonly dissentingOpinions: readonly ConsensusDissentingOpinion[];
  readonly calibratedScore: number;
  readonly arbitrationTimeMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ArenaEloDelta {
  readonly participantId: string;
  readonly modelId: string;
  readonly preRating: number;
  readonly postRating: number;
  readonly delta: number;
  readonly expectedScore: number;
  readonly actualScore: number;
  readonly kFactor: number;
  readonly matchesPlayed: number;
  readonly volatility?: number;
}

export interface ArenaEloMatchOutcome {
  readonly matchId: string;
  readonly timestamp: number;
  readonly participantA: string;
  readonly participantB: string;
  readonly scoreA: number;
  readonly scoreB: number;
  readonly deltaA: ArenaEloDelta;
  readonly deltaB: ArenaEloDelta;
}

export interface ArenaLeaderboardEntry {
  readonly participantId: string;
  readonly modelId: string;
  readonly rating: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly totalMatches: number;
  readonly winRate: number;
  readonly averageConfidence: number;
  readonly rank: number;
}

export interface ArenaLeaderboardSummary {
  readonly updatedAt: number;
  readonly totalMatches: number;
  readonly entries: readonly ArenaLeaderboardEntry[];
}

export interface ArenaSessionResult {
  readonly sessionId: string;
  readonly scenarioId?: string;
  readonly topic: string;
  readonly transcript: DebateTranscript;
  readonly arbitration: ConsensusArbitrationResult;
  readonly eloUpdates: readonly ArenaEloDelta[];
  readonly executionDurationMs: number;
  readonly timestamp: number;
}

export interface DebateEngineOptions {
  readonly defaultTimeoutMs?: number;
  readonly maxCrossExamRounds?: number;
  readonly temperature?: number;
  readonly callModel?: (
    participant: ArenaModelParticipant,
    systemPrompt: string,
    prompt: string
  ) => Promise<{ readonly text: string; readonly tokenUsage?: DebateTurnTokenUsage }>;
}

export interface ConsensusScorerOptions {
  readonly aggregationMethod?: ConsensusAggregationMethod;
  readonly outlierDetectionMethod?: OutlierDetectionMethod;
  readonly outlierThreshold?: number;
  readonly kFactor?: number;
  readonly initialElo?: number;
  readonly discountSelfBias?: boolean;
}

export interface ArenaEngineOptions {
  readonly debateOptions?: DebateEngineOptions;
  readonly scorerOptions?: ConsensusScorerOptions;
}

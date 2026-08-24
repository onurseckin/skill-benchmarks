export type DeterministicCheckType =
  | "command"
  | "file_content"
  | "file_exists"
  | "git_diff"
  | "ast_pattern"
  | "custom";

export interface DeterministicCheck {
  readonly id: string;
  readonly name: string;
  readonly type: DeterministicCheckType;
  readonly weight: number;
  readonly command?: string;
  readonly expectedExitCode?: number;
  readonly stdoutPattern?: string;
  readonly stderrPattern?: string;
  readonly filePath?: string;
  readonly fileContentPattern?: string;
  readonly mustExist?: boolean;
  readonly forbiddenPaths?: readonly string[];
  readonly maxFilesChanged?: number;
  readonly maxInsertions?: number;
  readonly maxDeletions?: number;
  readonly astPattern?: string;
  readonly customValidator?: (
    workspacePath: string
  ) => Promise<{
    readonly passed: boolean;
    readonly details?: string;
    readonly score?: number;
  }>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DeterministicCheckResult {
  readonly checkId: string;
  readonly name: string;
  readonly type: DeterministicCheckType;
  readonly passed: boolean;
  readonly score: number;
  readonly weight: number;
  readonly weightedScore: number;
  readonly executionTimeMs: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly errorDetails?: string;
  readonly violations?: readonly string[];
}

export interface GitDiffMetrics {
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly rawDiff: string;
  readonly modifiedFiles: readonly string[];
}

export interface DeterministicSummary {
  readonly allPassed: boolean;
  readonly passedChecksCount: number;
  readonly totalChecksCount: number;
  readonly rawScore: number;
  readonly weightedScore: number;
  readonly totalDurationMs: number;
  readonly checkResults: readonly DeterministicCheckResult[];
  readonly gitDiffMetrics?: GitDiffMetrics;
}

export interface JudgeRubricDimension {
  readonly name: string;
  readonly category:
    | "debugging"
    | "testing"
    | "security"
    | "documentation"
    | "code_review"
    | "general"
    | (string & {});
  readonly weight: number;
  readonly description: string;
  readonly criteria: Readonly<Record<number, string>>;
  readonly minScore?: number;
  readonly maxScore?: number;
}

export interface JudgeScoreResult {
  readonly dimensionName: string;
  readonly category: string;
  readonly score: number;
  readonly normalizedScore: number;
  readonly weight: number;
  readonly justification: string;
  readonly strengths?: readonly string[];
  readonly weaknesses?: readonly string[];
}

export interface JudgeEvaluationResult {
  readonly judgeModelId: string;
  readonly overallScore: number;
  readonly dimensionScores: readonly JudgeScoreResult[];
  readonly summary: string;
  readonly recommendations?: readonly string[];
  readonly latencyMs: number;
  readonly tokenCostUSD?: number;
  readonly rawJudgeResponse?: string;
}

export interface PairwiseCandidate {
  readonly candidateId: string;
  readonly skillId: string;
  readonly modelId: string;
  readonly runId: string;
  readonly gitDiff?: string;
  readonly finalMessage?: string;
  readonly executionOutput?: string;
}

export interface PairwiseEloMatch {
  readonly matchId: string;
  readonly scenarioId: string;
  readonly candidateA: PairwiseCandidate;
  readonly candidateB: PairwiseCandidate;
  readonly permutation1Winner: "candidate_a" | "candidate_b" | "tie";
  readonly permutation2Winner: "candidate_a" | "candidate_b" | "tie";
  readonly finalWinner: "candidate_a" | "candidate_b" | "tie";
  readonly positionBiasDetected: boolean;
  readonly judgeModelId: string;
  readonly confidenceScore?: number;
  readonly rationale: string;
  readonly timestamp: string;
}

export interface PairwiseWinRateStats {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly totalMatches: number;
  readonly winRate: number;
  readonly wilsonConfidenceInterval: readonly [number, number];
}

export interface PairwiseTournamentResult {
  readonly totalMatches: number;
  readonly matches: readonly PairwiseEloMatch[];
  readonly ratings: Readonly<Record<string, number>>;
  readonly winRates: Readonly<Record<string, PairwiseWinRateStats>>;
  readonly winMatrix: Readonly<
    Record<
      string,
      Readonly<
        Record<
          string,
          {
            readonly wins: number;
            readonly losses: number;
            readonly ties: number;
          }
        >
      >
    >
  >;
  readonly kFactor: number;
  readonly initialRating: number;
}

export interface EvaluationConfig {
  readonly scenarioId: string;
  readonly deterministicChecks?: readonly DeterministicCheck[];
  readonly rubricDimensions?: readonly JudgeRubricDimension[];
  readonly deterministicWeight: number;
  readonly semanticWeight: number;
  readonly passScoreThreshold: number;
  readonly requireAllDeterministicPass?: boolean;
  readonly judgeModelId?: string;
}

export interface CompositeEvaluationSummary {
  readonly scenarioId: string;
  readonly runId: string;
  readonly skillIds: readonly string[];
  readonly modelId: string;
  readonly passed: boolean;
  readonly compositeScore: number;
  readonly deterministicSummary?: DeterministicSummary;
  readonly judgeEvaluation?: JudgeEvaluationResult;
  readonly deterministicWeight: number;
  readonly semanticWeight: number;
  readonly passScoreThreshold: number;
  readonly evaluatedAt: string;
}

export interface EvaluationResult {
  readonly scenarioId: string;
  readonly runId: string;
  readonly success: boolean;
  readonly compositeSummary: CompositeEvaluationSummary;
  readonly deterministicSummary?: DeterministicSummary;
  readonly judgeEvaluation?: JudgeEvaluationResult;
}

export interface JudgePromptContext {
  readonly scenarioId: string;
  readonly scenarioDescription: string;
  readonly agentPrompt: string;
  readonly gitDiff: string;
  readonly agentFinalMessage: string;
  readonly executionLogs?: string;
  readonly rubrics: readonly JudgeRubricDimension[];
}

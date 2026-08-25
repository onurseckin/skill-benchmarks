import type { BenchmarkIneligibilityReason } from "../shared/benchmark-authority.js";

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

interface DeterministicSummaryBase {
  readonly totalDurationMs: number;
  readonly checkResults: readonly DeterministicCheckResult[];
  readonly gitDiffMetrics?: GitDiffMetrics;
}

export interface UnevaluatedDeterministicSummary extends DeterministicSummaryBase {
  readonly status: "not_evaluated" | "invalid";
  readonly reasons: readonly BenchmarkIneligibilityReason[];
}

export interface EvaluatedDeterministicSummary extends DeterministicSummaryBase {
  readonly status: "evaluated";
  readonly passed: boolean;
  readonly passedChecksCount: number;
  readonly totalChecksCount: number;
  readonly score: number;
  readonly evidenceDigest: string;
}

export type DeterministicSummary = UnevaluatedDeterministicSummary | EvaluatedDeterministicSummary;

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

interface CompositeEvaluationBase {
  readonly scenarioId: string;
  readonly runId: string;
  readonly skillIds: readonly string[];
  readonly modelId: string;
  readonly deterministicSummary?: DeterministicSummary;
  readonly judgeEvaluation?: JudgeEvaluationResult;
}

export interface UnevaluatedCompositeSummary extends CompositeEvaluationBase {
  readonly status: "not_evaluated" | "invalid";
  readonly reasons: readonly BenchmarkIneligibilityReason[];
}

export interface EvaluatedCompositeSummary extends CompositeEvaluationBase {
  readonly status: "evaluated";
  readonly passed: boolean;
  readonly compositeScore: number;
  readonly deterministicWeight: number;
  readonly semanticWeight: number;
  readonly passScoreThreshold: number;
  readonly requireAllDeterministicPass: boolean;
  readonly evaluatedAt: string;
}

export type CompositeEvaluationSummary = UnevaluatedCompositeSummary | EvaluatedCompositeSummary;

export interface EvaluationResult {
  readonly scenarioId: string;
  readonly runId: string;
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

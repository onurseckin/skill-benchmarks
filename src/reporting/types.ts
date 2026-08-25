export type RunStatus = "completed" | "failed" | "timed_out" | "aborted";

export type ExportFormat = "json" | "markdown" | "html" | "csv";

export interface ModelParameters {
  readonly temperature: number;
  readonly maxTokens?: number;
  readonly topP?: number;
}

export interface HostEnvironment {
  readonly os: string;
  readonly arch: string;
  readonly bunVersion: string;
  readonly hostCommitSha: string;
}

export interface RunManifest {
  readonly runId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly category: string;
  readonly skillId: string;
  readonly skillVersion?: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly modelParameters: ModelParameters;
  readonly environment: HostEnvironment;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: RunStatus;
}

export interface TimingBreakdown {
  readonly wallClockDurationMs: number;
  readonly timeToFirstTokenMs: number;
  readonly modelGenerationDurationMs: number;
  readonly toolExecutionDurationMs: number;
  readonly harnessOverheadMs: number;
}

export interface TokenBreakdown {
  readonly uncachedInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly completionOutputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
  readonly cacheHitRatio: number;
  readonly tokenBloatRate: number;
}

export interface CostBreakdown {
  readonly totalCostUSD: number;
  readonly inputCostUSD: number;
  readonly outputCostUSD: number;
  readonly effectiveCostMultiplier: number;
}

export interface InteractionBreakdown {
  readonly totalTurns: number;
  readonly totalToolCalls: number;
  readonly toolCallsPerTurnMean: number;
  readonly errorCount: number;
  readonly errorRecoveryRate: number;
}

export interface ToolMetricBreakdown {
  readonly callCount: number;
  readonly totalDurationMs: number;
  readonly meanDurationMs: number;
  readonly p95DurationMs: number;
  readonly errorCount: number;
}

export interface RunMetricsSummary {
  readonly runId: string;
  readonly timing: TimingBreakdown;
  readonly tokens: TokenBreakdown;
  readonly cost: CostBreakdown;
  readonly interaction: InteractionBreakdown;
  readonly toolBreakdowns: Readonly<Record<string, ToolMetricBreakdown>>;
}

export interface GitDiffMetrics {
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly rawDiff?: string;
}

export interface DeterministicCheckResult {
  readonly name?: string;
  readonly description: string;
  readonly passed: boolean;
  readonly exitCode?: number;
  readonly durationMs: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface DeterministicEvaluation {
  readonly passed: boolean;
  readonly score: number;
  readonly checks: ReadonlyArray<DeterministicCheckResult>;
  readonly gitDiffMetrics?: GitDiffMetrics;
}

export interface JudgeDimensionScore {
  readonly name: string;
  readonly score: number;
  readonly justification: string;
}

export interface JudgeEvaluation {
  readonly judgeModelId: string;
  readonly overallScore: number;
  readonly dimensions: ReadonlyArray<JudgeDimensionScore>;
  readonly summary: string;
}

export interface RunEvaluationSummary {
  readonly runId: string;
  readonly scenarioId: string;
  readonly deterministic: DeterministicEvaluation;
  readonly judge?: JudgeEvaluation;
  readonly compositeScore: number;
  readonly passedBenchmark: boolean;
}

export interface TelemetryEventRecord {
  readonly runId: string;
  readonly scenarioId: string;
  readonly skillId?: string;
  readonly modelId: string;
  readonly timestampUs: string;
  readonly eventType: string;
  readonly sequenceNumber?: number;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface RunRecord {
  readonly runId: string;
  readonly scenarioId: string;
  readonly category: string;
  readonly skillId: string;
  readonly skillVersion?: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly status: RunStatus;
  readonly compositeScore: number;
  readonly passedBenchmark: boolean;
  readonly wallClockMs: number;
  readonly totalTokens: number;
  readonly cacheHitRatio: number;
  readonly totalCostUSD: number;
  readonly totalTurns: number;
  readonly errorCount: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly manifest?: RunManifest;
  readonly metrics?: RunMetricsSummary;
  readonly evaluation?: RunEvaluationSummary;
}

export interface StatisticalMetrics {
  readonly mean: number;
  readonly median: number;
  readonly min?: number;
  readonly max?: number;
  readonly standardDeviation: number;
  readonly confidenceInterval95: readonly [number, number];
  readonly sampleCount: number;
  readonly pValueAgainstControl?: number;
  readonly isStatisticallySignificant?: boolean;
}

export interface SkillBenchmarkSummary {
  readonly skillId: string;
  readonly category: string;
  readonly totalRuns: number;
  readonly passRate: number;
  readonly averageScore: number;
  readonly meanDurationMs: number;
  readonly averageCostUSD: number;
  readonly averageCacheHitRatio: number;
  readonly eloRating: number;
  readonly scoreStats?: StatisticalMetrics;
  readonly durationStats?: StatisticalMetrics;
  readonly costStats?: StatisticalMetrics;
  readonly passRateImprovementOverControl?: number;
  readonly isStatisticallySignificant?: boolean;
}

export interface LeaderboardEntry {
  readonly rank: number;
  readonly skillId: string;
  readonly category: string;
  readonly passRate: number;
  readonly passRateDeltaOverControl?: number;
  readonly eloRating: number;
  readonly averageScore: number;
  readonly meanDurationSeconds: number;
  readonly averageCostUSD: number;
  readonly cacheHitRatio: number;
  readonly isStatisticallySignificant: boolean;
  readonly totalRuns: number;
}

export interface CategoryLeaderboard {
  readonly category: string;
  readonly entries: ReadonlyArray<LeaderboardEntry>;
  readonly topSkillId: string;
  readonly totalRuns: number;
  readonly updatedAt: string;
}

export interface CostEfficiencyPoint {
  readonly skillId: string;
  readonly modelId: string;
  readonly averageCostUSD: number;
  readonly compositeScore: number;
  readonly passRate: number;
  readonly tokensPerTask: number;
  readonly durationMs: number;
}

export interface RunQueryFilter {
  readonly scenarioId?: string;
  readonly skillId?: string;
  readonly modelId?: string;
  readonly providerId?: string;
  readonly category?: string;
  readonly status?: RunStatus;
  readonly passedBenchmark?: boolean;
  readonly minScore?: number;
  readonly maxScore?: number;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface EloRatingRecord {
  readonly skillId: string;
  readonly rating: number;
  readonly matchesPlayed: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly winRate: number;
  readonly confidenceInterval95: readonly [number, number];
  readonly lastUpdated: string;
}

export interface HistoricalTrendPoint {
  readonly timestamp: string;
  readonly commitSha?: string;
  readonly skillVersion?: string;
  readonly passRate: number;
  readonly averageScore: number;
  readonly meanDurationMs: number;
  readonly averageCostUSD: number;
  readonly eloRating: number;
  readonly sampleCount: number;
}

export interface NeoBrutalistDashboardConfig {
  readonly contrastRatio: number;
  readonly monochrome: true;
}

export const DASHBOARD_THEME_STYLE = "monochrome-neobrutalist";

import type { ExecutionMode } from "../shared/execution-mode.js";
import type {
  EligibleBenchmarkAuthority,
  NonEligibleBenchmarkAuthority,
  VerifiedCostEvidence,
} from "../shared/benchmark-authority.js";

export type RunStatus = "completed" | "failed" | "timed_out" | "aborted";

export type ExportFormat = "json" | "markdown" | "html" | "csv";

export interface ModelParameters {
  readonly temperature: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly thinkingLevel?: "none" | "low" | "medium" | "high" | "max";
  readonly thinkingBudgetTokens?: number;
  readonly reasoningEffort?: "low" | "medium" | "high";
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
  readonly executionMode: ExecutionMode;
  readonly simulated: boolean;
  readonly dryRun?: boolean;
  readonly modelParameters: ModelParameters;
  readonly environment: HostEnvironment;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: RunStatus;
  readonly terminationReason?: string;
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

export interface RunRecordBase {
  readonly sweepId?: string;
  readonly planFingerprint?: string;
  readonly cellId?: string;
  readonly matrixOccurrenceIndex?: number;
  readonly runId: string;
  readonly scenarioId: string;
  readonly category: string;
  readonly skillId: string;
  readonly skillVersion?: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly executionMode: ExecutionMode;
  readonly simulated: boolean;
  readonly dryRun: boolean;
  readonly thinkingLevel?: "none" | "low" | "medium" | "high" | "max";
  readonly thinkingBudgetTokens?: number;
  readonly reasoningTokens?: number;
  readonly status: RunStatus;
  readonly terminationReason?: string;
  readonly wallClockMs: number;
  readonly totalTokens: number;
  readonly cacheHitRatio: number;
  readonly totalTurns: number;
  readonly errorCount: number;
  readonly attemptCount?: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly manifest?: RunManifest;
  readonly metrics?: RunMetricsSummary;
}

export type EligibleRunRecord = RunRecordBase & EligibleBenchmarkAuthority;
export type NonEligibleRunRecord = RunRecordBase & NonEligibleBenchmarkAuthority;
export type RunRecord = EligibleRunRecord | NonEligibleRunRecord;
export type CostVerifiedEligibleRunRecord = EligibleRunRecord & {
  readonly operationalCost: VerifiedCostEvidence;
  readonly actualCostUSD: number;
};

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
  readonly averageCostUSD?: number;
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
  readonly modelId?: string;
  readonly modelTier?: "flagship" | "mid" | "small";
  readonly thinkingLevel?: "none" | "low" | "medium" | "high" | "max";
  readonly reasoningTokens?: number;
  readonly skillId: string;
  readonly category: string;
  readonly passRate: number;
  readonly passRateDeltaOverControl?: number;
  readonly eloRating: number;
  readonly averageScore: number;
  readonly meanDurationSeconds: number;
  readonly averageCostUSD?: number;
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

export interface NeoBrutalistDashboardConfig {
  readonly contrastRatio: number;
  readonly monochrome: true;
}

export const DASHBOARD_THEME_STYLE = "monochrome-neobrutalist";

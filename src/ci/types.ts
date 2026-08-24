import type {
  RunRecord,
  StatisticalMetrics,
  SkillBenchmarkSummary,
  LeaderboardEntry,
  CategoryLeaderboard,
} from "../reporting/types.js";

export type CiBenchmarkEventType =
  | "ci:start"
  | "ci:sweep:start"
  | "ci:sweep:cell_complete"
  | "ci:sweep:cell_error"
  | "ci:sweep:complete"
  | "ci:diff:computed"
  | "ci:comment:posted"
  | "ci:regression:detected"
  | "ci:complete"
  | "ci:error";

export type CiWorkflowTrigger =
  | "pull_request"
  | "push"
  | "workflow_dispatch"
  | "schedule";

export interface CiBenchmarkEvent {
  readonly type: CiBenchmarkEventType;
  readonly timestamp: string;
  readonly runId: string;
  readonly commitSha?: string;
  readonly prNumber?: number;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly error?: string;
}

export interface CiBenchmarkContext {
  readonly workflowTrigger: CiWorkflowTrigger;
  readonly commitSha: string;
  readonly baseSha?: string;
  readonly branchName: string;
  readonly baseBranch: string;
  readonly prNumber?: number;
  readonly actor: string;
  readonly runId: string;
  readonly repository: string;
  readonly dryRun: boolean;
}

export type RegressionStatus =
  | "improved"
  | "regressed"
  | "neutral"
  | "critical_regression";

export type RegressionVerdictStatus = "PASS" | "FAIL" | "WARNING";

export interface MetricDelta {
  readonly metricName: string;
  readonly baselineValue: number;
  readonly candidateValue: number;
  readonly absoluteDelta: number;
  readonly percentageDelta: number;
  readonly isImprovement: boolean;
  readonly isRegression: boolean;
  readonly isStatisticallySignificant: boolean;
  readonly pValue?: number;
  readonly effectSize?: number;
}

export interface SkillRegressionDelta {
  readonly skillId: string;
  readonly category: string;
  readonly baselineScore: number;
  readonly candidateScore: number;
  readonly scoreDelta: number;
  readonly baselinePassRate: number;
  readonly candidatePassRate: number;
  readonly passRateDelta: number;
  readonly baselineDurationMs: number;
  readonly candidateDurationMs: number;
  readonly durationDeltaMs: number;
  readonly baselineCostUSD: number;
  readonly candidateCostUSD: number;
  readonly costDeltaUSD: number;
  readonly baselineTokens: number;
  readonly candidateTokens: number;
  readonly tokenDelta: number;
  readonly baselineCacheHitRatio: number;
  readonly candidateCacheHitRatio: number;
  readonly cacheHitRatioDelta: number;
  readonly baselineElo: number;
  readonly candidateElo: number;
  readonly eloDelta: number;
  readonly pValue?: number;
  readonly isStatisticallySignificant: boolean;
  readonly status: RegressionStatus;
}

export interface ScenarioRegressionDelta {
  readonly scenarioId: string;
  readonly baselinePassRate: number;
  readonly candidatePassRate: number;
  readonly passRateDelta: number;
  readonly baselineDurationMs: number;
  readonly candidateDurationMs: number;
  readonly durationDeltaMs: number;
  readonly baselineScore: number;
  readonly candidateScore: number;
  readonly scoreDelta: number;
  readonly status: RegressionStatus;
}

export interface RegressionSummary {
  readonly verdict: RegressionVerdictStatus;
  readonly totalSkillsEvaluated: number;
  readonly improvedSkillsCount: number;
  readonly regressedSkillsCount: number;
  readonly criticalRegressionsCount: number;
  readonly neutralSkillsCount: number;
  readonly overallScoreDelta: number;
  readonly overallPassRateDelta: number;
  readonly overallEloDrift: number;
  readonly isStatisticallySignificant: boolean;
  readonly skillDeltas: readonly SkillRegressionDelta[];
  readonly scenarioDeltas: readonly ScenarioRegressionDelta[];
  readonly criticalFindings: readonly string[];
  readonly recommendations: readonly string[];
  readonly evaluatedAt: string;
}

export interface EloDriftThresholds {
  readonly warningDriftThreshold: number;
  readonly criticalDriftThreshold: number;
  readonly maxAllowedScoreDrop: number;
  readonly maxAllowedPassRateDrop: number;
  readonly significanceAlpha: number;
  readonly minSampleCount: number;
}

export interface RegressionDetectorConfig {
  readonly thresholds: EloDriftThresholds;
  readonly failOnCriticalRegression: boolean;
  readonly failOnAnyRegression: boolean;
  readonly minSampleCountForSignificance: number;
  readonly baselineDbPath?: string;
  readonly candidateDbPath?: string;
}

export interface ApcaBadgeStyle {
  readonly label: string;
  readonly value: string;
  readonly backgroundColor: string;
  readonly textColor: string;
  readonly contrastRatio: number;
  readonly accessible: boolean;
  readonly icon?: string;
}

export type MetricDiffCardType = "positive" | "negative" | "neutral";

export interface MetricDiffCard {
  readonly title: string;
  readonly baselineFormatted: string;
  readonly candidateFormatted: string;
  readonly deltaFormatted: string;
  readonly deltaType: MetricDiffCardType;
  readonly badgeStyle?: ApcaBadgeStyle;
}

export interface PrLeaderboardCommentOptions {
  readonly prNumber: number;
  readonly commitSha: string;
  readonly baseSha?: string;
  readonly repoOwner?: string;
  readonly repoName?: string;
  readonly githubToken?: string;
  readonly updateExistingComment: boolean;
  readonly commentTagMarker?: string;
  readonly includeScenarioBreakdown: boolean;
  readonly includeMetricCards: boolean;
  readonly includeCostAnalysis: boolean;
  readonly maxSkillsToShow?: number;
}

export interface PrCommentPayload {
  readonly body: string;
  readonly commentId?: number;
  readonly isNewComment: boolean;
  readonly postedAt: string;
  readonly htmlUrl?: string;
}

export interface GitHubCommentClientConfig {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly apiBaseUrl?: string;
}

export interface RegressionComparisonInput {
  readonly baselineRuns: readonly RunRecord[];
  readonly candidateRuns: readonly RunRecord[];
  readonly baselineSummaries?: readonly SkillBenchmarkSummary[];
  readonly candidateSummaries?: readonly SkillBenchmarkSummary[];
  readonly baselineLeaderboard?: readonly LeaderboardEntry[];
  readonly candidateLeaderboard?: readonly LeaderboardEntry[];
  readonly categoryLeaderboards?: readonly CategoryLeaderboard[];
  readonly config?: Partial<RegressionDetectorConfig>;
}

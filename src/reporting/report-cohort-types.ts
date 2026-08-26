import type {
  BenchmarkCohort,
  BenchmarkEligibilityStatus,
  BenchmarkIneligibilityReason,
  EvaluationOutcomeStatus,
  EvidenceStateStatus,
} from "../shared/benchmark-authority.js";
import type { ExecutionMode } from "../shared/execution-mode.js";
import type { ObservedStatistics } from "./report-statistics.js";
import type { RunStatus } from "./types.js";

export type ReportAuthority = "eligible" | "diagnostic";

export interface ReportFilter {
  readonly scenarioIds?: readonly string[];
  readonly categories?: readonly string[];
  readonly skillIds?: readonly string[];
  readonly modelIds?: readonly string[];
  readonly providerIds?: readonly string[];
  readonly statuses?: readonly RunStatus[];
  readonly executionModes?: readonly ExecutionMode[];
  readonly simulated?: boolean;
  readonly authority?: ReportAuthority;
  readonly benchmarkCohorts?: readonly BenchmarkCohort[];
  readonly eligibilityStatuses?: readonly BenchmarkEligibilityStatus[];
  readonly evaluationStatuses?: readonly EvaluationOutcomeStatus[];
  readonly evidenceStatuses?: readonly EvidenceStateStatus[];
  readonly fromDate?: string;
  readonly toDate?: string;
}

export interface RunQueryFilter extends ReportFilter {
  readonly passedBenchmark?: boolean;
  readonly minScore?: number;
  readonly maxScore?: number;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ReportSampleMean {
  readonly mean: number;
  readonly sampleCount: number;
}

export interface ReportLeaderboardEntry {
  readonly rank: number;
  readonly category: string;
  readonly skillId: string;
  readonly scenarioIds: readonly string[];
  readonly modelIds: readonly string[];
  readonly providerIds: readonly string[];
  readonly eligibleRunCount: number;
  readonly passCount: number;
  readonly failedBenchmarkCount: number;
  readonly passRate: number;
  readonly passRateConfidence95: readonly [number, number];
  readonly score: ObservedStatistics;
  readonly duration: ReportSampleMean;
  readonly cacheHitRatio?: ReportSampleMean;
  readonly verifiedActualCost?: ReportSampleMean;
}

export interface ReportCategoryLeaderboard {
  readonly category: string;
  readonly entries: readonly ReportLeaderboardEntry[];
  readonly totalEligibleRuns: number;
  readonly topSkillId?: string;
}

export interface ReportTrendPoint {
  readonly date: string;
  readonly eligibleRunCount: number;
  readonly passCount: number;
  readonly passRate: number;
  readonly score: ReportSampleMean;
  readonly duration: ReportSampleMean;
  readonly verifiedActualCost?: ReportSampleMean;
}

export interface ReportCostPoint {
  readonly category: string;
  readonly skillId: string;
  readonly modelId: string;
  readonly averageVerifiedActualCostUSD: number;
  readonly averageScore: number;
  readonly passRate: number;
  readonly sampleCount: number;
}

export interface ReportLatencyPercentiles {
  readonly method: "nearest_rank";
  readonly sampleCount: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p99Ms: number;
}

export interface ReportVelocityPoint {
  readonly category: string;
  readonly skillId: string;
  readonly modelId: string;
  readonly meanTokensPerSecond: number;
  readonly sampleCount: number;
}

export interface ReportProvenanceFacts {
  readonly executionModeCounts: Readonly<Record<ExecutionMode, number>>;
  readonly simulatedRunCount: number;
  readonly nonSimulatedRunCount: number;
  readonly cohortCounts: Readonly<Record<BenchmarkCohort, number>>;
  readonly eligibilityCounts: Readonly<Record<BenchmarkEligibilityStatus, number>>;
  readonly evaluationStatusCounts: Readonly<Record<EvaluationOutcomeStatus, number>>;
  readonly evidenceStatusCounts: Readonly<Record<EvidenceStateStatus, number>>;
  readonly lifecycleStatusCounts: Readonly<Record<RunStatus, number>>;
  readonly eligibilityReasonCounts: readonly {
    readonly reason: BenchmarkIneligibilityReason;
    readonly count: number;
  }[];
  readonly evidenceThrough?: string;
}

export interface ReportSnapshot {
  readonly schemaVersion: "1.0.0";
  readonly generatedAt: string;
  readonly filter: ReportFilter;
  readonly matchedRunCount: number;
  readonly eligibleRunCount: number;
  readonly diagnosticRunCount: number;
  readonly provenance: ReportProvenanceFacts;
  readonly leaderboard: readonly ReportLeaderboardEntry[];
  readonly categoryLeaderboards: readonly ReportCategoryLeaderboard[];
  readonly trends?: readonly ReportTrendPoint[];
  readonly costEfficiency?: readonly ReportCostPoint[];
  readonly latencyPercentiles?: ReportLatencyPercentiles;
  readonly tokenVelocity?: readonly ReportVelocityPoint[];
}

export interface ReportBuildOptions {
  readonly generatedAt?: string;
  readonly includeTrends?: boolean;
  readonly includeCostEfficiency?: boolean;
}

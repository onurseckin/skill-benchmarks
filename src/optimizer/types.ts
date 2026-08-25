export type BudgetTier = "free" | "standard" | "premium" | "enterprise" | "custom";

export type BudgetState = "normal" | "warning" | "exhausted" | "bursting" | "throttled";

export type ThrottleReason =
  | "rate_limit_rpm"
  | "rate_limit_tpm"
  | "budget_exhaustion"
  | "latency_sla_breach"
  | "circuit_breaker_open"
  | "concurrency_limit";

export type ThrottleSeverity = "low" | "medium" | "high" | "critical";

export type LoadSheddingAction =
  | "allow"
  | "delay"
  | "downgrade_model"
  | "truncate_context"
  | "reject";

export type CircuitBreakerState = "closed" | "open" | "half_open";

export type SpeculationMode = "disabled" | "aggressive" | "conservative" | "adaptive";

export type CachingMode = "none" | "ephemeral" | "persistent" | "tiered";

export type OptimizerTarget = "cost" | "latency" | "throughput" | "balanced" | "quality";

export interface TokenAllocation {
  readonly promptTokensLimit: number;
  readonly completionTokensLimit: number;
  readonly totalTokensLimit: number;
  readonly reservedCapacity: number;
  readonly burstAllowance: number;
  readonly softCapRatio: number;
  readonly hardCapRatio: number;
}

export interface TokenBudgetProfile {
  readonly id: string;
  readonly name: string;
  readonly tier: BudgetTier;
  readonly allocation: TokenAllocation;
  readonly maxSpendUSD: number;
  readonly resetIntervalMs: number;
  readonly allowBurst: boolean;
  readonly autoScale: boolean;
}

export interface BudgetUsageSnapshot {
  readonly profileId: string;
  readonly promptTokensUsed: number;
  readonly completionTokensUsed: number;
  readonly totalTokensUsed: number;
  readonly totalSpendUSD: number;
  readonly state: BudgetState;
  readonly utilizationRatio: number;
  readonly remainingTokens: number;
  readonly remainingSpendUSD: number;
  readonly burstTokensUsed: number;
  readonly timestamp: number;
}

export interface RateCeilingConfig {
  readonly maxRequestsPerMinute: number;
  readonly maxTokensPerMinute: number;
  readonly maxConcurrentRequests: number;
  readonly windowSizeMs: number;
  readonly minRequestsPerMinute: number;
  readonly minTokensPerMinute: number;
  readonly scaleUpFactor: number;
  readonly scaleDownFactor: number;
  readonly cooldownPeriodMs: number;
}

export interface RateWindowStats {
  readonly requestCount: number;
  readonly tokenCount: number;
  readonly currentRPM: number;
  readonly currentTPM: number;
  readonly averageLatencyMs: number;
  readonly errorCount: number;
  readonly windowStart: number;
  readonly windowEnd: number;
}

export interface DynamicRateLimitState {
  readonly providerId: string;
  readonly currentMaxRPM: number;
  readonly currentMaxTPM: number;
  readonly activeConcurrency: number;
  readonly maxConcurrency: number;
  readonly lastAdjustmentTimestamp: number;
  readonly windowStats: RateWindowStats;
  readonly circuitBreakerState: CircuitBreakerState;
  readonly failureStreak: number;
  readonly successStreak: number;
}

export interface RateCeilingAdjustment {
  readonly providerId: string;
  readonly previousMaxRPM: number;
  readonly newMaxRPM: number;
  readonly previousMaxTPM: number;
  readonly newMaxTPM: number;
  readonly reason: string;
  readonly timestamp: number;
  readonly factorApplied: number;
}

export interface TTFTTarget {
  readonly targetMs: number;
  readonly maxAcceptableMs: number;
  readonly p95TargetMs: number;
}

export interface TPSTarget {
  readonly minTokensPerSecond: number;
  readonly targetTokensPerSecond: number;
}

export interface LatencySLA {
  readonly ttft: TTFTTarget;
  readonly tps: TPSTarget;
  readonly maxTotalLatencyMs: number;
  readonly timeoutMs: number;
}

export interface StreamBufferingStrategy {
  readonly enabled: boolean;
  readonly bufferChunkSize: number;
  readonly flushIntervalMs: number;
  readonly adaptiveBuffering: boolean;
}

export interface EarlyStoppingCriteria {
  readonly maxConsecutiveIdenticalTokens: number;
  readonly tokenBudgetHardCeiling: number;
  readonly stopSequences: readonly string[];
  readonly enableHeuristicPruning: boolean;
}

export interface LatencyOptimizationHeuristic {
  readonly sla: LatencySLA;
  readonly streamBuffering: StreamBufferingStrategy;
  readonly earlyStopping: EarlyStoppingCriteria;
  readonly speculationMode: SpeculationMode;
  readonly cachingMode: CachingMode;
  readonly targetTokenPerSecond: number;
}

export interface ModelPricingRateOverride {
  readonly inputPerThousand: number;
  readonly outputPerThousand: number;
  readonly cachedInputPerThousand?: number;
  readonly reasoningOutputPerThousand?: number;
}

export interface CostBreakdownUSD {
  readonly inputCostUSD: number;
  readonly outputCostUSD: number;
  readonly cachedInputCostUSD: number;
  readonly reasoningCostUSD: number;
  readonly totalCostUSD: number;
}

export interface CostEfficiencyMetrics {
  readonly costPerThousandTokensUSD: number;
  readonly promptCostPerThousandUSD: number;
  readonly completionCostPerThousandUSD: number;
  readonly cacheSavingsRatio: number;
  readonly totalSpendUSD: number;
  readonly costPerformanceRatio: number;
}

export interface ThrottleEvent {
  readonly id: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly reason: ThrottleReason;
  readonly severity: ThrottleSeverity;
  readonly action: LoadSheddingAction;
  readonly retryAfterMs: number;
  readonly promptTokens: number;
  readonly estimatedTokens: number;
  readonly timestamp: number;
  readonly context: Readonly<Record<string, unknown>>;
}


export interface MitigationTelemetry {
  readonly totalThrottleEvents: number;
  readonly eventsByReason: Readonly<Record<ThrottleReason, number>>;
  readonly eventsBySeverity: Readonly<Record<ThrottleSeverity, number>>;
  readonly actionsApplied: Readonly<Record<LoadSheddingAction, number>>;
  readonly averageRetryDelayMs: number;
  readonly rejectedRequests: number;
  readonly downgradedRequests: number;
  readonly delayedRequests: number;
  readonly lastEventTimestamp: number;
}

export interface OptimizationConstraint {
  readonly maxCostUSDPerExecution?: number;
  readonly maxTotalLatencyMs?: number;
  readonly minQualityScore?: number;
  readonly minTokensPerSecond?: number;
  readonly maxTTFTMs?: number;
  readonly allowedProviders?: readonly string[];
  readonly preferredModels?: readonly string[];
}

export interface ParetoCandidate {
  readonly providerId: string;
  readonly modelId: string;
  readonly estimatedCostUSD: number;
  readonly estimatedLatencyMs: number;
  readonly estimatedTTFTMs: number;
  readonly estimatedTPS: number;
  readonly expectedQualityScore: number;
  readonly costPerThousandUSD: number;
}

export interface ParetoFrontierPoint {
  readonly candidate: ParetoCandidate;
  readonly isParetoOptimal: boolean;
  readonly dominanceScore: number;
  readonly efficiencyScore: number;
  readonly costRank: number;
  readonly latencyRank: number;
  readonly qualityRank: number;
}

export interface ModelRoutingRecommendation {
  readonly recommendedModel: string;
  readonly recommendedProvider: string;
  readonly fallbackModel?: string;
  readonly fallbackProvider?: string;
  readonly target: OptimizerTarget;
  readonly frontierPoint: ParetoFrontierPoint;
  readonly projectedCostUSD: number;
  readonly projectedLatencyMs: number;
  readonly rationale: string;
}

export interface OptimizationReport {
  readonly scenarioId: string;
  readonly target: OptimizerTarget;
  readonly constraints: OptimizationConstraint;
  readonly candidatesEvaluated: number;
  readonly paretoFrontier: readonly ParetoFrontierPoint[];
  readonly recommendation: ModelRoutingRecommendation;
  readonly fallbackChain: readonly ModelRoutingRecommendation[];
  readonly timestamp: number;
}

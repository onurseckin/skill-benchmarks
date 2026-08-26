import type {
  CircuitBreakerState,
  CostBreakdownUSD,
  ModelPricingRateOverride,
  RateCeilingConfig,
  RateWindowStats,
  TokenBudgetProfile,
} from "./types.js";

interface InternalWindowRecord {
  readonly timestamp: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly latencyMs: number;
  readonly isError: boolean;
}

export interface ProviderRateBucket {
  config: RateCeilingConfig;
  currentMaxRPM: number;
  currentMaxTPM: number;
  activeConcurrency: number;
  lastAdjustmentTimestamp: number;
  circuitBreaker: CircuitBreakerState;
  circuitBreakerResetAt: number;
  failureStreak: number;
  successStreak: number;
  history: InternalWindowRecord[];
}

export interface InternalProfileState {
  profile: TokenBudgetProfile;
  promptTokensUsed: number;
  completionTokensUsed: number;
  totalSpendUSD: number;
  burstTokensUsed: number;
  lastResetTimestamp: number;
}

export function calculateBudgetCost(
  override: ModelPricingRateOverride | undefined,
  promptTokens: number,
  completionTokens: number,
  cachedPromptTokens: number,
  reasoningTokens: number,
): CostBreakdownUSD {
  const inputRate = override !== undefined ? override.inputPerThousand : 0.003;
  const outputRate = override !== undefined ? override.outputPerThousand : 0.015;
  const cacheRate =
    override !== undefined && override.cachedInputPerThousand !== undefined
      ? override.cachedInputPerThousand
      : inputRate * 0.1;
  const reasoningRate =
    override !== undefined && override.reasoningOutputPerThousand !== undefined
      ? override.reasoningOutputPerThousand
      : outputRate;
  const inputCost = (Math.max(0, promptTokens - cachedPromptTokens) / 1000) * inputRate;
  const cacheCost = (cachedPromptTokens / 1000) * cacheRate;
  const outputCost = (Math.max(0, completionTokens - reasoningTokens) / 1000) * outputRate;
  const reasoningCost = (reasoningTokens / 1000) * reasoningRate;
  return {
    inputCostUSD: inputCost,
    outputCostUSD: outputCost,
    cachedInputCostUSD: cacheCost,
    reasoningCostUSD: reasoningCost,
    totalCostUSD: inputCost + cacheCost + outputCost + reasoningCost,
  };
}

export function pruneRateHistory(bucket: ProviderRateBucket): void {
  const cutoff = Date.now() - bucket.config.windowSizeMs;
  bucket.history = bucket.history.filter((record) => record.timestamp >= cutoff);
}

export function computeRateWindowStats(bucket: ProviderRateBucket): RateWindowStats {
  const now = Date.now();
  let tokens = 0;
  let latencySum = 0;
  let errors = 0;
  for (const record of bucket.history) {
    tokens += record.promptTokens + record.completionTokens;
    latencySum += record.latencyMs;
    if (record.isError) errors += 1;
  }
  const count = bucket.history.length;
  const minutes = bucket.config.windowSizeMs / 60000;
  return {
    requestCount: count,
    tokenCount: tokens,
    currentRPM: minutes > 0 ? count / minutes : 0,
    currentTPM: minutes > 0 ? tokens / minutes : 0,
    averageLatencyMs: count > 0 ? latencySum / count : 0,
    errorCount: errors,
    windowStart: now - bucket.config.windowSizeMs,
    windowEnd: now,
  };
}

export function resetProfileIfDue(profileState: InternalProfileState): void {
  const now = Date.now();
  if (now - profileState.lastResetTimestamp >= profileState.profile.resetIntervalMs) {
    profileState.promptTokensUsed = 0;
    profileState.completionTokensUsed = 0;
    profileState.totalSpendUSD = 0;
    profileState.burstTokensUsed = 0;
    profileState.lastResetTimestamp = now;
  }
}

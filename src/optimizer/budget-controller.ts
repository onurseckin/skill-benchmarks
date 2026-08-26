import {
  BudgetState,
  BudgetUsageSnapshot,
  CostBreakdownUSD,
  DynamicRateLimitState,
  LoadSheddingAction,
  MitigationTelemetry,
  ModelPricingRateOverride,
  RateCeilingAdjustment,
  RateCeilingConfig,
  ThrottleEvent,
  ThrottleReason,
  ThrottleSeverity,
  TokenBudgetProfile,
} from "./types.js";
import {
  calculateBudgetCost,
  computeRateWindowStats,
  pruneRateHistory,
  resetProfileIfDue,
  type InternalProfileState,
  type ProviderRateBucket,
} from "./budget-state.js";

export class BudgetController {
  private readonly profiles = new Map<string, InternalProfileState>();
  private readonly providers = new Map<string, ProviderRateBucket>();
  private readonly adjustments: RateCeilingAdjustment[] = [];
  private readonly throttleEvents: ThrottleEvent[] = [];
  private readonly pricingOverrides = new Map<string, ModelPricingRateOverride>();

  public registerProfile(profile: TokenBudgetProfile): void {
    this.profiles.set(profile.id, {
      profile,
      promptTokensUsed: 0,
      completionTokensUsed: 0,
      totalSpendUSD: 0,
      burstTokensUsed: 0,
      lastResetTimestamp: Date.now(),
    });
  }

  public registerProviderCeiling(providerId: string, config: RateCeilingConfig): void {
    this.providers.set(providerId, {
      config,
      currentMaxRPM: config.maxRequestsPerMinute,
      currentMaxTPM: config.maxTokensPerMinute,
      activeConcurrency: 0,
      lastAdjustmentTimestamp: Date.now(),
      circuitBreaker: "closed",
      circuitBreakerResetAt: 0,
      failureStreak: 0,
      successStreak: 0,
      history: [],
    });
  }

  public registerPricingOverride(modelId: string, override: ModelPricingRateOverride): void {
    this.pricingOverrides.set(modelId, override);
  }

  public canExecute(
    profileId: string,
    providerId: string,
    estimatedTokens: number,
  ): { allowed: boolean; action: LoadSheddingAction; reason?: string; retryAfterMs?: number } {
    const pState = this.profiles.get(profileId);
    if (!pState) return { allowed: false, action: "reject", reason: "Profile not found" };
    this.checkAndResetProfile(pState);

    const alloc = pState.profile.allocation;
    const totalUsed = pState.promptTokensUsed + pState.completionTokensUsed;
    const projectedTotal = totalUsed + estimatedTokens;
    if (pState.totalSpendUSD >= pState.profile.maxSpendUSD) {
      return { allowed: false, action: "reject", reason: "Budget max spend USD reached" };
    }
    if (projectedTotal > alloc.totalTokensLimit) {
      if (pState.profile.allowBurst) {
        const burstRemaining = alloc.burstAllowance - pState.burstTokensUsed;
        if (projectedTotal - alloc.totalTokensLimit > burstRemaining) {
          return { allowed: false, action: "reject", reason: "Token budget burst limit exceeded" };
        }
      } else {
        return { allowed: false, action: "reject", reason: "Token budget hard limit reached" };
      }
    }

    const bucket = this.providers.get(providerId);
    if (!bucket) return { allowed: true, action: "allow" };
    this.pruneHistory(bucket);

    if (bucket.circuitBreaker === "open") {
      if (Date.now() >= bucket.circuitBreakerResetAt) {
        bucket.circuitBreaker = "half_open";
      } else {
        const retryAfterMs = Math.max(0, bucket.circuitBreakerResetAt - Date.now());
        return { allowed: false, action: "delay", reason: "Circuit breaker open", retryAfterMs };
      }
    }
    if (bucket.activeConcurrency >= bucket.config.maxConcurrentRequests) {
      return {
        allowed: false,
        action: "delay",
        reason: "Max concurrency reached",
        retryAfterMs: 250,
      };
    }
    if (bucket.history.length >= bucket.currentMaxRPM) {
      return { allowed: false, action: "delay", reason: "RPM limit reached", retryAfterMs: 1000 };
    }
    const currentTPM = bucket.history.reduce((a, r) => a + r.promptTokens + r.completionTokens, 0);
    if (currentTPM + estimatedTokens > bucket.currentMaxTPM) {
      return { allowed: false, action: "delay", reason: "TPM limit reached", retryAfterMs: 1000 };
    }
    return { allowed: true, action: "allow" };
  }

  public acquireSlot(providerId: string): boolean {
    const bucket = this.providers.get(providerId);
    if (!bucket) return true;
    if (bucket.activeConcurrency >= bucket.config.maxConcurrentRequests) return false;
    bucket.activeConcurrency += 1;
    return true;
  }

  public releaseSlot(
    profileId: string,
    providerId: string,
    modelId: string,
    promptTokens: number,
    completionTokens: number,
    latencyMs: number,
    costUSD: number,
    isError: boolean = false,
  ): void {
    const bucket = this.providers.get(providerId);
    if (bucket) {
      bucket.activeConcurrency = Math.max(0, bucket.activeConcurrency - 1);
      bucket.history.push({
        timestamp: Date.now(),
        promptTokens,
        completionTokens,
        latencyMs,
        isError,
      });
      if (isError) {
        bucket.failureStreak += 1;
        bucket.successStreak = 0;
        if (bucket.failureStreak >= 5) {
          bucket.circuitBreaker = "open";
          bucket.circuitBreakerResetAt = Date.now() + bucket.config.cooldownPeriodMs;
        }
      } else {
        bucket.successStreak += 1;
        bucket.failureStreak = 0;
        if (bucket.circuitBreaker === "half_open") bucket.circuitBreaker = "closed";
        if (bucket.successStreak >= 20) this.scaleUpCeiling(providerId, bucket);
      }
    }
    const pState = this.profiles.get(profileId);
    if (pState) {
      this.checkAndResetProfile(pState);
      pState.promptTokensUsed += promptTokens;
      pState.completionTokensUsed += completionTokens;
      pState.totalSpendUSD += costUSD;
      const newTotal = pState.promptTokensUsed + pState.completionTokensUsed;
      if (newTotal > pState.profile.allocation.totalTokensLimit) {
        const over = newTotal - pState.profile.allocation.totalTokensLimit;
        pState.burstTokensUsed = Math.min(
          pState.profile.allocation.burstAllowance,
          Math.max(0, over),
        );
      }
    }
  }

  public recordThrottleEvent(
    providerId: string,
    modelId: string,
    reason: ThrottleReason,
    severity: ThrottleSeverity,
    action: LoadSheddingAction,
    retryAfterMs: number,
    promptTokens: number,
    estimatedTokens: number,
    context: Readonly<Record<string, unknown>> = {},
  ): ThrottleEvent {
    const event: ThrottleEvent = {
      id: `thr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      providerId,
      modelId,
      reason,
      severity,
      action,
      retryAfterMs,
      promptTokens,
      estimatedTokens,
      timestamp: Date.now(),
      context,
    };
    this.throttleEvents.push(event);
    const bucket = this.providers.get(providerId);
    if (bucket) this.scaleDownCeiling(providerId, bucket, reason);
    return event;
  }

  public getUsageSnapshot(profileId: string): BudgetUsageSnapshot | undefined {
    const pState = this.profiles.get(profileId);
    if (!pState) return undefined;
    this.checkAndResetProfile(pState);
    const totalUsed = pState.promptTokensUsed + pState.completionTokensUsed;
    const limit = pState.profile.allocation.totalTokensLimit;
    const ratio = limit > 0 ? totalUsed / limit : 0;
    let state: BudgetState = "normal";
    if (ratio >= 1.0) {
      state = pState.burstTokensUsed > 0 ? "bursting" : "exhausted";
    } else if (ratio >= pState.profile.allocation.softCapRatio) {
      state = "warning";
    }
    return {
      profileId,
      promptTokensUsed: pState.promptTokensUsed,
      completionTokensUsed: pState.completionTokensUsed,
      totalTokensUsed: totalUsed,
      totalSpendUSD: pState.totalSpendUSD,
      state,
      utilizationRatio: Math.min(1.0, ratio),
      remainingTokens: Math.max(0, limit - totalUsed),
      remainingSpendUSD: Math.max(0, pState.profile.maxSpendUSD - pState.totalSpendUSD),
      burstTokensUsed: pState.burstTokensUsed,
      timestamp: Date.now(),
    };
  }

  public getDynamicRateLimitState(providerId: string): DynamicRateLimitState | undefined {
    const bucket = this.providers.get(providerId);
    if (!bucket) return undefined;
    this.pruneHistory(bucket);
    return {
      providerId,
      currentMaxRPM: bucket.currentMaxRPM,
      currentMaxTPM: bucket.currentMaxTPM,
      activeConcurrency: bucket.activeConcurrency,
      maxConcurrency: bucket.config.maxConcurrentRequests,
      lastAdjustmentTimestamp: bucket.lastAdjustmentTimestamp,
      windowStats: this.computeWindowStats(bucket),
      circuitBreakerState: bucket.circuitBreaker,
      failureStreak: bucket.failureStreak,
      successStreak: bucket.successStreak,
    };
  }

  public getMitigationTelemetry(): MitigationTelemetry {
    const byReason: Record<ThrottleReason, number> = {
      rate_limit_rpm: 0,
      rate_limit_tpm: 0,
      budget_exhaustion: 0,
      latency_sla_breach: 0,
      circuit_breaker_open: 0,
      concurrency_limit: 0,
    };
    const bySeverity: Record<ThrottleSeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    const actions: Record<LoadSheddingAction, number> = {
      allow: 0,
      delay: 0,
      downgrade_model: 0,
      truncate_context: 0,
      reject: 0,
    };
    let totalDelayMs = 0,
      rejected = 0,
      downgraded = 0,
      delayed = 0,
      lastTimestamp = 0;
    for (const ev of this.throttleEvents) {
      const curR = byReason[ev.reason];
      byReason[ev.reason] = (curR !== undefined ? curR : 0) + 1;
      const curS = bySeverity[ev.severity];
      bySeverity[ev.severity] = (curS !== undefined ? curS : 0) + 1;
      const curA = actions[ev.action];
      actions[ev.action] = (curA !== undefined ? curA : 0) + 1;
      totalDelayMs += ev.retryAfterMs;
      if (ev.action === "reject") rejected += 1;
      if (ev.action === "downgrade_model") downgraded += 1;
      if (ev.action === "delay") delayed += 1;
      if (ev.timestamp > lastTimestamp) lastTimestamp = ev.timestamp;
    }
    const count = this.throttleEvents.length;
    return {
      totalThrottleEvents: count,
      eventsByReason: byReason,
      eventsBySeverity: bySeverity,
      actionsApplied: actions,
      averageRetryDelayMs: count > 0 ? totalDelayMs / count : 0,
      rejectedRequests: rejected,
      downgradedRequests: downgraded,
      delayedRequests: delayed,
      lastEventTimestamp: lastTimestamp,
    };
  }

  public calculateCost(
    modelId: string,
    promptTokens: number,
    completionTokens: number,
    cachedPromptTokens: number = 0,
    reasoningTokens: number = 0,
  ): CostBreakdownUSD {
    return calculateBudgetCost(
      this.pricingOverrides.get(modelId),
      promptTokens,
      completionTokens,
      cachedPromptTokens,
      reasoningTokens,
    );
  }

  private scaleDownCeiling(providerId: string, bucket: ProviderRateBucket, reason: string): void {
    const prevRPM = bucket.currentMaxRPM;
    const prevTPM = bucket.currentMaxTPM;
    bucket.currentMaxRPM = Math.max(
      bucket.config.minRequestsPerMinute,
      Math.floor(bucket.currentMaxRPM * bucket.config.scaleDownFactor),
    );
    bucket.currentMaxTPM = Math.max(
      bucket.config.minTokensPerMinute,
      Math.floor(bucket.currentMaxTPM * bucket.config.scaleDownFactor),
    );
    bucket.lastAdjustmentTimestamp = Date.now();
    bucket.successStreak = 0;
    this.adjustments.push({
      providerId,
      previousMaxRPM: prevRPM,
      newMaxRPM: bucket.currentMaxRPM,
      previousMaxTPM: prevTPM,
      newMaxTPM: bucket.currentMaxTPM,
      reason: `Scale down: ${reason}`,
      timestamp: Date.now(),
      factorApplied: bucket.config.scaleDownFactor,
    });
  }

  private scaleUpCeiling(providerId: string, bucket: ProviderRateBucket): void {
    if (
      bucket.currentMaxRPM >= bucket.config.maxRequestsPerMinute &&
      bucket.currentMaxTPM >= bucket.config.maxTokensPerMinute
    )
      return;
    const prevRPM = bucket.currentMaxRPM;
    const prevTPM = bucket.currentMaxTPM;
    bucket.currentMaxRPM = Math.min(
      bucket.config.maxRequestsPerMinute,
      Math.ceil(bucket.currentMaxRPM * bucket.config.scaleUpFactor),
    );
    bucket.currentMaxTPM = Math.min(
      bucket.config.maxTokensPerMinute,
      Math.ceil(bucket.currentMaxTPM * bucket.config.scaleUpFactor),
    );
    bucket.lastAdjustmentTimestamp = Date.now();
    bucket.successStreak = 0;
    this.adjustments.push({
      providerId,
      previousMaxRPM: prevRPM,
      newMaxRPM: bucket.currentMaxRPM,
      previousMaxTPM: prevTPM,
      newMaxTPM: bucket.currentMaxTPM,
      reason: "Scale up on success streak",
      timestamp: Date.now(),
      factorApplied: bucket.config.scaleUpFactor,
    });
  }

  private pruneHistory(bucket: ProviderRateBucket): void {
    pruneRateHistory(bucket);
  }

  private computeWindowStats(bucket: ProviderRateBucket) {
    return computeRateWindowStats(bucket);
  }

  private checkAndResetProfile(pState: InternalProfileState): void {
    resetProfileIfDue(pState);
  }
}

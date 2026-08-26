import type { RateLimitConfig, ITokenBucketRateLimiter, ProviderRateLimitPolicy } from "./types.js";
import { ExecutionAbortedError, resolveAbortReason } from "../shared/cancellation.js";
import {
  createProviderTurnPermit,
  type ProviderTurnOutcome,
  type ProviderTurnPermit,
} from "../shared/provider-turn-permit.js";

interface QueuedTokenRequest {
  readonly estimatedTokens: number;
  readonly resolve: (permit: ProviderTurnPermit) => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
}

export class RateLimiterAbortedError extends ExecutionAbortedError {
  constructor(message = "Rate limiter request aborted") {
    super("rate_limit", message);
    this.name = "RateLimiterAbortedError";
  }
}

export class TokenBucketRateLimiter implements ITokenBucketRateLimiter {
  public readonly providerId: string;
  public readonly modelId?: string;

  private readonly maxRpm: number;
  private readonly maxTpm: number;
  private readonly maxConcurrent: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly backoffFactor: number;
  private readonly jitterEnabled: boolean;

  private availableRequests: number;
  private availableTokens: number;
  private inFlightRequests = 0;
  private lastRefillTimestamp: number;
  private consecutiveThrottles = 0;
  private backoffUntilTimestamp = 0;

  private readonly queue: QueuedTokenRequest[] = [];
  private drainScheduled = false;
  private drainTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(providerId: string, config: RateLimitConfig, modelId?: string) {
    this.providerId = providerId;
    this.modelId = modelId;

    this.maxRpm = Math.max(1, config.maxRequestsPerMinute);
    this.maxTpm = Math.max(1, config.maxTokensPerMinute);
    this.maxConcurrent = config.maxConcurrentRequests ?? 50;

    const initialRatio = config.initialTokensRatio ?? 1.0;
    this.availableRequests = this.maxRpm * initialRatio;
    this.availableTokens = this.maxTpm * initialRatio;

    this.backoffBaseMs = config.backoffBaseMs ?? 500;
    this.backoffMaxMs = config.backoffMaxMs ?? 30000;
    this.backoffFactor = config.backoffFactor ?? 2.0;
    this.jitterEnabled = config.jitter ?? true;

    this.lastRefillTimestamp = Date.now();
  }

  private refillTokens(): void {
    const now = Date.now();
    const elapsedMs = Math.max(0, now - this.lastRefillTimestamp);
    if (elapsedMs === 0) {
      return;
    }

    const requestRefill = (this.maxRpm / 60000) * elapsedMs;
    const tokenRefill = (this.maxTpm / 60000) * elapsedMs;

    this.availableRequests = Math.min(this.maxRpm, this.availableRequests + requestRefill);
    this.availableTokens = Math.min(this.maxTpm, this.availableTokens + tokenRefill);
    this.lastRefillTimestamp = now;
  }

  private calculateBackoffDelay(): number {
    const exponent = Math.min(this.consecutiveThrottles, 6);
    const rawDelay = this.backoffBaseMs * Math.pow(this.backoffFactor, exponent);
    const cappedDelay = Math.min(this.backoffMaxMs, rawDelay);

    if (!this.jitterEnabled) {
      return cappedDelay;
    }

    const jitterRatio = 0.5 + Math.random() * 0.5;
    return Math.floor(cappedDelay * jitterRatio);
  }

  private processQueue(): void {
    if (this.queue.length === 0) {
      if (this.drainTimer !== undefined) {
        clearTimeout(this.drainTimer);
        this.drainTimer = undefined;
      }
      this.drainScheduled = false;
      return;
    }

    this.refillTokens();
    const now = Date.now();

    if (now < this.backoffUntilTimestamp) {
      const waitMs = this.backoffUntilTimestamp - now;
      if (!this.drainScheduled) {
        this.drainScheduled = true;
        this.drainTimer = setTimeout(() => {
          this.drainTimer = undefined;
          this.drainScheduled = false;
          this.processQueue();
        }, waitMs);
      }
      return;
    }

    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (!next) {
        break;
      }

      if (next.signal?.aborted) {
        this.queue.shift();
        next.reject(resolveAbortReason(next.signal, "rate_limit"));
        continue;
      }

      if (this.inFlightRequests >= this.maxConcurrent) {
        break;
      }

      if (this.availableRequests < 1.0) {
        break;
      }

      const requiredTokens = Math.min(next.estimatedTokens, this.maxTpm);
      if (this.availableTokens < requiredTokens && this.availableTokens < this.maxTpm * 0.1) {
        break;
      }

      this.queue.shift();
      next.resolve(this.reservePermit(requiredTokens));
    }

    if (this.queue.length > 0 && !this.drainScheduled) {
      this.drainScheduled = true;
      const tpmRefillPerMs = this.maxTpm / 60000;
      const rpmRefillPerMs = this.maxRpm / 60000;
      const timeForReqMs =
        rpmRefillPerMs > 0 ? Math.ceil((1.0 - this.availableRequests) / rpmRefillPerMs) : 100;
      const nextEst = this.queue[0]?.estimatedTokens ?? 1000;
      const timeForTokMs =
        tpmRefillPerMs > 0 ? Math.ceil((nextEst - this.availableTokens) / tpmRefillPerMs) : 100;
      const delayMs = Math.max(20, Math.min(2000, Math.max(timeForReqMs, timeForTokMs)));

      this.drainTimer = setTimeout(() => {
        this.drainTimer = undefined;
        this.drainScheduled = false;
        this.processQueue();
      }, delayMs);
    }
  }

  async acquire(estimatedTokens: number, signal?: AbortSignal): Promise<ProviderTurnPermit> {
    if (signal?.aborted) {
      throw resolveAbortReason(signal, "rate_limit");
    }

    this.refillTokens();
    const now = Date.now();

    const isBackingOff = now < this.backoffUntilTimestamp;
    const hasCapacity =
      !isBackingOff &&
      this.queue.length === 0 &&
      this.inFlightRequests < this.maxConcurrent &&
      this.availableRequests >= 1.0 &&
      (this.availableTokens >= estimatedTokens || this.availableTokens >= this.maxTpm * 0.1);

    if (hasCapacity) {
      return this.reservePermit(Math.min(estimatedTokens, this.maxTpm));
    }

    return new Promise<ProviderTurnPermit>((resolve, reject) => {
      let queuedRequest: QueuedTokenRequest;
      const abortListener = () => {
        const idx = this.queue.indexOf(queuedRequest);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        reject(resolveAbortReason(signal, "rate_limit"));
        this.processQueue();
      };

      if (signal) {
        signal.addEventListener("abort", abortListener, { once: true });
      }

      queuedRequest = {
        estimatedTokens,
        resolve: (permit) => {
          if (signal) {
            signal.removeEventListener("abort", abortListener);
          }
          resolve(permit);
        },
        reject: (err) => {
          if (signal) {
            signal.removeEventListener("abort", abortListener);
          }
          reject(err);
        },
        signal,
      };
      this.queue.push(queuedRequest);

      this.processQueue();
    });
  }

  private reservePermit(estimatedTokens: number): ProviderTurnPermit {
    const reservedTokens = Math.min(this.maxTpm, Math.max(0, estimatedTokens));
    this.availableRequests -= 1;
    this.availableTokens = Math.max(0, this.availableTokens - reservedTokens);
    this.inFlightRequests += 1;
    return createProviderTurnPermit((outcome, actualTokens, retryAfterMs) => {
      this.finalizePermit(reservedTokens, outcome, actualTokens, retryAfterMs);
    });
  }

  private finalizePermit(
    reservedTokens: number,
    outcome: ProviderTurnOutcome,
    actualTokens: number | undefined,
    retryAfterMs: number | undefined,
  ): void {
    this.inFlightRequests = Math.max(0, this.inFlightRequests - 1);
    this.refillTokens();

    if (outcome === "rate_limited") {
      this.consecutiveThrottles += 1;
      const backoffMs = Math.min(
        this.backoffMaxMs,
        Math.max(0, retryAfterMs ?? this.calculateBackoffDelay()),
      );
      this.backoffUntilTimestamp = Date.now() + backoffMs;
      this.availableRequests = 0;
      this.availableTokens = 0;
    } else {
      const reconciledTokens = resolveReconciledTokens(
        outcome,
        actualTokens,
        reservedTokens,
      );
      this.availableTokens = Math.min(
        this.maxTpm,
        Math.max(0, this.availableTokens + reservedTokens - reconciledTokens),
      );
      this.consecutiveThrottles = Math.max(0, this.consecutiveThrottles - 1);
    }
    this.processQueue();
  }

  getStatus(): {
    readonly availableTokens: number;
    readonly availableRequests: number;
    readonly isThrottled: boolean;
    readonly queueDepth: number;
    readonly activePermits: number;
  } {
    this.refillTokens();
    return {
      availableTokens: Math.floor(this.availableTokens),
      availableRequests: Math.floor(this.availableRequests),
      isThrottled: Date.now() < this.backoffUntilTimestamp,
      queueDepth: this.queue.length,
      activePermits: this.inFlightRequests,
    };
  }
}

function normalizeActualTokens(actualTokens: number | undefined, estimatedTokens: number): number {
  if (actualTokens === undefined || !Number.isFinite(actualTokens)) return estimatedTokens;
  return Math.max(0, actualTokens);
}

function resolveReconciledTokens(
  outcome: ProviderTurnOutcome,
  actualTokens: number | undefined,
  estimatedTokens: number,
): number {
  if (actualTokens !== undefined) return normalizeActualTokens(actualTokens, estimatedTokens);
  return outcome === "completed" ? estimatedTokens : 0;
}

export class MultiProviderRateLimiter {
  private readonly limiters = new Map<string, TokenBucketRateLimiter>();
  private readonly policies: readonly ProviderRateLimitPolicy[];

  constructor(policies: readonly ProviderRateLimitPolicy[] = []) {
    this.policies = policies;
    for (const policy of policies) {
      const defaultLimiter = new TokenBucketRateLimiter(policy.providerId, policy.defaultRateLimit);
      this.limiters.set(policy.providerId, defaultLimiter);

      if (policy.modelOverrides) {
        for (const [modelId, overrideConfig] of Object.entries(policy.modelOverrides)) {
          const merged: RateLimitConfig = {
            ...policy.defaultRateLimit,
            ...overrideConfig,
          };
          const modelLimiter = new TokenBucketRateLimiter(policy.providerId, merged, modelId);
          this.limiters.set(`${policy.providerId}:${modelId}`, modelLimiter);
        }
      }
    }
  }

  getLimiter(providerId: string, modelId?: string): ITokenBucketRateLimiter {
    if (modelId) {
      const specificKey = `${providerId}:${modelId}`;
      const specific = this.limiters.get(specificKey);
      if (specific) {
        return specific;
      }
    }

    const defaultLimiter = this.limiters.get(providerId);
    if (defaultLimiter) {
      return defaultLimiter;
    }

    const fallbackPolicy = this.policies.find((p) => p.providerId === providerId);
    const fallbackConfig: RateLimitConfig = fallbackPolicy?.defaultRateLimit ?? {
      maxRequestsPerMinute: 60,
      maxTokensPerMinute: 100000,
      maxConcurrentRequests: 10,
    };

    const newLimiter = new TokenBucketRateLimiter(providerId, fallbackConfig, modelId);
    const key = modelId ? `${providerId}:${modelId}` : providerId;
    this.limiters.set(key, newLimiter);
    return newLimiter;
  }
}

export function createDefaultRateLimiter(
  providerId: string,
  modelId?: string,
): ITokenBucketRateLimiter {
  const defaultConfig: RateLimitConfig = {
    maxRequestsPerMinute: 60,
    maxTokensPerMinute: 100000,
    maxConcurrentRequests: 10,
    backoffBaseMs: 500,
    backoffMaxMs: 30000,
    backoffFactor: 2.0,
    jitter: true,
  };
  return new TokenBucketRateLimiter(providerId, defaultConfig, modelId);
}

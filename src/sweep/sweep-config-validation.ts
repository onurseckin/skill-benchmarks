import type { ExecutionLimits } from "../runner/types.js";
import type { ConcurrencyControls, MatrixSweepConfig, RateLimitConfig } from "./types.js";

const invalidSweepConfigurationMessage = "Sweep configuration contains an invalid value";

export function validateMatrixSweepConfig(config: MatrixSweepConfig): void {
  if (config === null || typeof config !== "object" || config.runtimeConfig === null
    || typeof config.runtimeConfig !== "object") invalid();
  requireString(config.runtimeConfig.outputRoot);
  requireEnum(config.runtimeConfig.executionMode, ["fake", "live"]);
  optionalEnum(config.runtimeConfig.requestedProviderId, ["anthropic", "openai", "google", "ollama", "custom"]);
  optionalString(config.sweepId);
  requireStringArray(config.scenarioIds);
  requireStringArray(config.skillIds);
  optionalInteger(config.repetitions, 1);
  optionalBoolean(config.dryRun);
  optionalInteger(config.maxRetriesPerCell, 0);
  optionalBoolean(config.stopOnFirstFailure);
  optionalString(config.workspaceRoot);
  optionalString(config.telemetryDbPath);
  validateConcurrency(config.concurrency);
  validateLimits(config.defaultExecutionLimits);
  validateCheckpoint(config.checkpoint);
  if (config.rateLimits !== undefined && !Array.isArray(config.rateLimits)) invalid();
  if (!Array.isArray(config.models)) invalid();
  for (const policy of config.rateLimits ?? []) {
    if (policy === null || typeof policy !== "object") invalid();
    requireString(policy.providerId);
    validateRateLimit(policy.defaultRateLimit);
    const overrides: Readonly<Record<string, Partial<RateLimitConfig>>> = policy.modelOverrides ?? {};
    for (const override of Object.values(overrides)) validatePartialRateLimit(override);
  }
  for (const model of config.models) {
    if (model === null || typeof model !== "object") invalid();
    requireString(model.modelId);
    requireString(model.providerId);
    optionalString(model.displayName);
    optionalFiniteNumber(model.temperature);
    optionalFiniteNumber(model.topP);
    optionalInteger(model.maxTokens, 1);
    optionalInteger(model.thinkingBudget, 0);
    optionalInteger(model.concurrencyLimit, 1);
    optionalEnum(model.thinkingLevel, ["none", "low", "medium", "high", "max"]);
    optionalEnum(model.reasoningEffort, ["low", "medium", "high"]);
    if (model.rateLimit !== undefined) validateRateLimit(model.rateLimit);
    if (model.tags !== undefined) requireStringArray(model.tags);
    if (model.metadata !== undefined) validateMetadataNumbers(model.metadata, new WeakSet<object>());
  }
  if (config.thinkingLevels !== undefined) {
    if (!Array.isArray(config.thinkingLevels)) invalid();
    for (const level of config.thinkingLevels) requireEnum(level, ["none", "low", "medium", "high", "max"]);
  }
}

function validatePartialRateLimit(value: Partial<RateLimitConfig>): void {
  if (value === null || typeof value !== "object") invalid();
  optionalFiniteNumber(value.maxRequestsPerMinute, 0);
  optionalFiniteNumber(value.maxTokensPerMinute, 0);
  optionalInteger(value.maxConcurrentRequests, 1);
  optionalInteger(value.refillIntervalMs, 1);
  optionalFiniteNumber(value.initialTokensRatio, 0);
  optionalInteger(value.backoffBaseMs, 0);
  optionalInteger(value.backoffMaxMs, 0);
  optionalFiniteNumber(value.backoffFactor, 0);
  optionalBoolean(value.jitter);
}

function validateConcurrency(value: Partial<ConcurrencyControls> | undefined): void {
  if (value === undefined) return;
  if (value === null || typeof value !== "object") invalid();
  optionalInteger(value.maxGlobalConcurrency, 1);
  optionalInteger(value.maxPerModelConcurrency, 1);
  optionalInteger(value.maxPerProviderConcurrency, 1);
  optionalInteger(value.maxPerScenarioConcurrency, 1);
  optionalInteger(value.containerAcquisitionTimeoutMs, 1);
  optionalInteger(value.queuePollIntervalMs, 1);
}

function validateLimits(value: Partial<ExecutionLimits> | undefined): void {
  if (value === undefined) return;
  if (value === null || typeof value !== "object") invalid();
  optionalInteger(value.maxTurns, 1);
  optionalInteger(value.maxWallClockTimeMs, 1);
  optionalFiniteNumber(value.maxCostUSD, 0);
  optionalInteger(value.maxConsecutiveToolFailures, 0);
  optionalInteger(value.toolTimeoutMs, 1);
  optionalInteger(value.maxOutputSizeBytes, 1);
  optionalBoolean(value.stopOnToolFailures);
}

function validateCheckpoint(value: MatrixSweepConfig["checkpoint"]): void {
  if (value === undefined) return;
  if (value === null || typeof value !== "object") invalid();
  optionalBoolean(value.enabled);
  optionalString(value.filePath);
  optionalInteger(value.saveIntervalMs, 1);
  optionalBoolean(value.saveOnCellCompletion);
  optionalInteger(value.maxBackups, 0);
  optionalBoolean(value.autoResume);
}

function validateRateLimit(value: RateLimitConfig): void {
  if (value === null || typeof value !== "object") invalid();
  requireFiniteNumber(value.maxRequestsPerMinute, 0);
  requireFiniteNumber(value.maxTokensPerMinute, 0);
  optionalInteger(value.maxConcurrentRequests, 1);
  optionalInteger(value.refillIntervalMs, 1);
  optionalFiniteNumber(value.initialTokensRatio, 0);
  optionalInteger(value.backoffBaseMs, 0);
  optionalInteger(value.backoffMaxMs, 0);
  optionalFiniteNumber(value.backoffFactor, 0);
  optionalBoolean(value.jitter);
}

function validateMetadataNumbers(value: unknown, ancestors: WeakSet<object>): void {
  if (typeof value === "number" && !Number.isFinite(value)) invalid();
  if (value === null) invalid();
  if (typeof value !== "object") return;
  if (ancestors.has(value)) return;
  ancestors.add(value);
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length" && Array.isArray(value)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor?.get !== undefined || descriptor?.set !== undefined) continue;
      validateMetadataNumbers(descriptor?.value, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function requireStringArray(value: readonly string[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) invalid();
}

function optionalString(value: string | undefined): void {
  if (value !== undefined) requireString(value);
}

function requireString(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) invalid();
}

function optionalBoolean(value: boolean | undefined): void {
  if (value !== undefined && typeof value !== "boolean") invalid();
}

function optionalInteger(value: number | undefined, minimum: number): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum)) invalid();
}

function optionalFiniteNumber(value: number | undefined, minimum?: number): void {
  if (value !== undefined) requireFiniteNumber(value, minimum);
}

function requireFiniteNumber(value: number, minimum?: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || (minimum !== undefined && value < minimum)) invalid();
}

function optionalEnum<T extends string>(value: T | undefined, allowed: readonly T[]): void {
  if (value !== undefined) requireEnum(value, allowed);
}

function requireEnum<T extends string>(value: T, allowed: readonly T[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) invalid();
}

function invalid(): never {
  throw new TypeError(invalidSweepConfigurationMessage);
}

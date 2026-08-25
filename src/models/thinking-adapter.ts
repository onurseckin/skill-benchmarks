import type { GenerateOptions, ProviderId } from "../providers/types.js";
import { getModelDefinition, getOrCreateModelDefinition } from "./model-registry.js";
import type {
  NormalizedModelDefinition,
  ProviderThinkingPayload,
  ThinkingEffortLevel,
  ThinkingValidationResult,
} from "./types.js";

const DEFAULT_BUDGET_MAP: Record<ThinkingEffortLevel, number> = {
  none: 0,
  low: 2048,
  medium: 8192,
  high: 16384,
  max: 32768,
};

export function resolveBudgetFromEffort(
  level: ThinkingEffortLevel,
  model?: NormalizedModelDefinition,
  explicitBudget?: number
): number {
  if (explicitBudget !== undefined && explicitBudget > 0) {
    if (model?.thinkingConfig !== undefined) {
      return Math.max(
        model.thinkingConfig.minBudgetTokens,
        Math.min(model.thinkingConfig.maxBudgetTokens, explicitBudget)
      );
    }
    return explicitBudget;
  }

  if (level === "none") return 0;

  if (model?.thinkingConfig !== undefined) {
    const min = model.thinkingConfig.minBudgetTokens;
    const max = model.thinkingConfig.maxBudgetTokens;
    if (level === "low") return Math.max(min, Math.round(min + (max - min) * 0.15));
    if (level === "medium") return Math.max(min, model.thinkingConfig.defaultBudgetTokens);
    if (level === "high") return Math.max(min, Math.round(min + (max - min) * 0.65));
    if (level === "max") return max;
  }

  return DEFAULT_BUDGET_MAP[level];
}

export function mapEffortLevelToOpenAI(
  level: ThinkingEffortLevel
): "low" | "medium" | "high" {
  if (level === "none" || level === "low") return "low";
  if (level === "high" || level === "max") return "high";
  return "medium";
}

export function validateThinkingOptions(
  modelId: string,
  level: ThinkingEffortLevel,
  explicitBudget?: number
): ThinkingValidationResult {
  const model = getModelDefinition(modelId);

  if (level === "none" && (explicitBudget === undefined || explicitBudget === 0)) {
    return { valid: true, normalizedLevel: "none", normalizedBudget: 0 };
  }

  if (model !== undefined && !model.capabilities.reasoning) {
    return {
      valid: false,
      reason: `Model ${modelId} does not support reasoning/thinking mode`,
      normalizedLevel: "none",
      normalizedBudget: 0,
    };
  }

  const budget = resolveBudgetFromEffort(level, model, explicitBudget);

  if (model?.thinkingConfig !== undefined) {
    if (budget < model.thinkingConfig.minBudgetTokens && level !== "none") {
      return {
        valid: false,
        reason: `Budget ${budget} is below minimum allowed ${model.thinkingConfig.minBudgetTokens} for model ${modelId}`,
        normalizedLevel: level,
        normalizedBudget: model.thinkingConfig.minBudgetTokens,
      };
    }
    if (budget > model.thinkingConfig.maxBudgetTokens) {
      return {
        valid: false,
        reason: `Budget ${budget} exceeds maximum allowed ${model.thinkingConfig.maxBudgetTokens} for model ${modelId}`,
        normalizedLevel: level,
        normalizedBudget: model.thinkingConfig.maxBudgetTokens,
      };
    }
  }

  return { valid: true, normalizedLevel: level, normalizedBudget: budget };
}

export function buildProviderThinkingPayload(
  provider: ProviderId,
  modelId: string,
  level: ThinkingEffortLevel,
  explicitBudget?: number
): ProviderThinkingPayload {
  const model = getOrCreateModelDefinition(modelId, provider);
  const budget = resolveBudgetFromEffort(level, model, explicitBudget);

  if (level === "none" || budget === 0) {
    return { level: "none", budgetTokens: 0 };
  }

  if (provider === "anthropic") {
    const safeAnthropicBudget = Math.max(1024, budget);
    return {
      level,
      budgetTokens: safeAnthropicBudget,
      anthropic: {
        type: "enabled",
        budget_tokens: safeAnthropicBudget,
      },
    };
  }

  if (provider === "openai") {
    const reasoningEffort = mapEffortLevelToOpenAI(level);
    return {
      level,
      budgetTokens: budget,
      openai: {
        reasoning_effort: reasoningEffort,
      },
    };
  }

  if (provider === "google") {
    return {
      level,
      budgetTokens: budget,
      gemini: {
        thinkingConfig: {
          thinkingBudget: budget,
        },
      },
    };
  }

  return { level, budgetTokens: budget };
}

export function applyThinkingToGenerateOptions(
  options: GenerateOptions,
  provider: ProviderId,
  modelId: string,
  level?: ThinkingEffortLevel,
  explicitBudget?: number
): GenerateOptions {
  if (level === undefined && explicitBudget === undefined && options.thinkingBudgetTokens === undefined) {
    return options;
  }

  const effectiveLevel: ThinkingEffortLevel =
    level !== undefined ? level : options.thinkingBudgetTokens !== undefined && options.thinkingBudgetTokens > 0 ? "medium" : "none";

  const payload = buildProviderThinkingPayload(
    provider,
    modelId,
    effectiveLevel,
    explicitBudget !== undefined ? explicitBudget : options.thinkingBudgetTokens
  );

  const model = getOrCreateModelDefinition(modelId, provider);
  let temperature = options.temperature;
  let maxTokens = options.maxTokens;

  if (model.thinkingConfig?.temperatureConstraint !== undefined && payload.budgetTokens !== undefined && payload.budgetTokens > 0) {
    temperature = model.thinkingConfig.temperatureConstraint;
  }

  if (payload.budgetTokens !== undefined && payload.budgetTokens > 0) {
    const requiredMinMaxTokens = payload.budgetTokens + 4096;
    if (maxTokens === undefined || maxTokens < requiredMinMaxTokens) {
      maxTokens = Math.min(model.capabilities.maxOutputTokens, requiredMinMaxTokens);
    }
  }

  return {
    ...options,
    temperature,
    maxTokens,
    thinkingBudgetTokens: payload.budgetTokens,
  };
}

import { ModelPricingRate, ProviderPricingConfig, TokenUsage } from "./types";

export interface DetailedCostBreakdown {
  readonly uncachedInputCostUSD: number;
  readonly cacheWriteCostUSD: number;
  readonly cacheReadCostUSD: number;
  readonly standardOutputCostUSD: number;
  readonly reasoningOutputCostUSD: number;
  readonly totalCostUSD: number;
}

const DEFAULT_ANTHROPIC_RATE: ModelPricingRate = {
  uncachedInputPerM: 3.0,
  cacheWritePerM: 3.75,
  cacheReadPerM: 0.3,
  standardOutputPerM: 15.0,
  reasoningOutputPerM: 15.0,
};

const DEFAULT_OPENAI_RATE: ModelPricingRate = {
  uncachedInputPerM: 2.5,
  cacheWritePerM: 2.5,
  cacheReadPerM: 1.25,
  standardOutputPerM: 10.0,
  reasoningOutputPerM: 10.0,
};

const DEFAULT_GEMINI_RATE: ModelPricingRate = {
  uncachedInputPerM: 0.1,
  cacheWritePerM: 0.1,
  cacheReadPerM: 0.025,
  standardOutputPerM: 0.4,
  reasoningOutputPerM: 0.4,
};

export const DEFAULT_MODEL_PRICING: Readonly<Record<string, ModelPricingRate>> = {
  "claude-3-5-sonnet-20241022": DEFAULT_ANTHROPIC_RATE,
  "claude-3-5-sonnet-latest": DEFAULT_ANTHROPIC_RATE,
  "claude-3-7-sonnet-20250219": DEFAULT_ANTHROPIC_RATE,
  "claude-3-5-haiku-20241022": {
    uncachedInputPerM: 0.8,
    cacheWritePerM: 1.0,
    cacheReadPerM: 0.08,
    standardOutputPerM: 4.0,
    reasoningOutputPerM: 4.0,
  },
  "claude-3-opus-20240229": {
    uncachedInputPerM: 15.0,
    cacheWritePerM: 18.75,
    cacheReadPerM: 1.5,
    standardOutputPerM: 75.0,
    reasoningOutputPerM: 75.0,
  },
  "gpt-4o": DEFAULT_OPENAI_RATE,
  "gpt-4o-2024-11-20": DEFAULT_OPENAI_RATE,
  "gpt-4o-mini": {
    uncachedInputPerM: 0.15,
    cacheWritePerM: 0.15,
    cacheReadPerM: 0.075,
    standardOutputPerM: 0.6,
    reasoningOutputPerM: 0.6,
  },
  o1: {
    uncachedInputPerM: 15.0,
    cacheWritePerM: 15.0,
    cacheReadPerM: 7.5,
    standardOutputPerM: 60.0,
    reasoningOutputPerM: 60.0,
  },
  "o3-mini": {
    uncachedInputPerM: 1.1,
    cacheWritePerM: 1.1,
    cacheReadPerM: 0.55,
    standardOutputPerM: 4.4,
    reasoningOutputPerM: 4.4,
  },
  "gemini-2.0-flash": DEFAULT_GEMINI_RATE,
  "gemini-2.0-flash-exp": DEFAULT_GEMINI_RATE,
  "gemini-2.0-pro-exp-02-05": {
    uncachedInputPerM: 1.25,
    cacheWritePerM: 1.25,
    cacheReadPerM: 0.3125,
    standardOutputPerM: 5.0,
    reasoningOutputPerM: 5.0,
  },
  "gemini-1.5-pro": {
    uncachedInputPerM: 1.25,
    cacheWritePerM: 1.25,
    cacheReadPerM: 0.3125,
    standardOutputPerM: 5.0,
    reasoningOutputPerM: 5.0,
  },
  "gemini-1.5-flash": {
    uncachedInputPerM: 0.075,
    cacheWritePerM: 0.075,
    cacheReadPerM: 0.01875,
    standardOutputPerM: 0.3,
    reasoningOutputPerM: 0.3,
  },
  default: DEFAULT_OPENAI_RATE,
};

const customPricingRegistry = new Map<string, ModelPricingRate>();

export function registerModelPricing(modelId: string, rate: ModelPricingRate): void {
  customPricingRegistry.set(modelId, rate);
}

export function clearRegisteredModelPricing(): void {
  customPricingRegistry.clear();
}

export function getModelPricingRate(
  modelId: string,
  overrides?: ProviderPricingConfig,
): ModelPricingRate {
  if (overrides !== undefined && overrides[modelId] !== undefined) {
    const overrideRate = overrides[modelId];
    if (overrideRate !== undefined) {
      return overrideRate;
    }
  }
  const custom = customPricingRegistry.get(modelId);
  if (custom !== undefined) {
    return custom;
  }
  if (DEFAULT_MODEL_PRICING[modelId] !== undefined) {
    const defaultRate = DEFAULT_MODEL_PRICING[modelId];
    if (defaultRate !== undefined) {
      return defaultRate;
    }
  }
  for (const key of Object.keys(DEFAULT_MODEL_PRICING)) {
    if (key !== "default" && modelId.startsWith(key)) {
      const prefixRate = DEFAULT_MODEL_PRICING[key];
      if (prefixRate !== undefined) {
        return prefixRate;
      }
    }
  }
  if (overrides !== undefined && overrides.default !== undefined) {
    const defaultOverride = overrides.default;
    if (defaultOverride !== undefined) {
      return defaultOverride;
    }
  }
  const fallback = DEFAULT_MODEL_PRICING.default;
  return fallback !== undefined ? fallback : DEFAULT_OPENAI_RATE;
}

export function calculateDetailedCostUSD(
  modelId: string,
  usage: TokenUsage,
  overrides?: ProviderPricingConfig,
): DetailedCostBreakdown {
  const rate = getModelPricingRate(modelId, overrides);
  const uncachedTokens = Math.max(
    0,
    usage.inputTokens - usage.cacheCreationInputTokens - usage.cacheReadInputTokens,
  );
  const uncachedInputCostUSD = (uncachedTokens / 1_000_000) * rate.uncachedInputPerM;
  const cacheWriteCostUSD = (usage.cacheCreationInputTokens / 1_000_000) * rate.cacheWritePerM;
  const cacheReadCostUSD = (usage.cacheReadInputTokens / 1_000_000) * rate.cacheReadPerM;
  const reasoningTokens =
    usage.reasoningOutputTokens !== undefined ? usage.reasoningOutputTokens : 0;
  const standardOutputTokens = Math.max(0, usage.outputTokens - reasoningTokens);
  const reasoningRate =
    rate.reasoningOutputPerM !== undefined ? rate.reasoningOutputPerM : rate.standardOutputPerM;
  const standardOutputCostUSD = (standardOutputTokens / 1_000_000) * rate.standardOutputPerM;
  const reasoningOutputCostUSD = (reasoningTokens / 1_000_000) * reasoningRate;
  const totalCostUSD =
    uncachedInputCostUSD +
    cacheWriteCostUSD +
    cacheReadCostUSD +
    standardOutputCostUSD +
    reasoningOutputCostUSD;

  return {
    uncachedInputCostUSD,
    cacheWriteCostUSD,
    cacheReadCostUSD,
    standardOutputCostUSD,
    reasoningOutputCostUSD,
    totalCostUSD,
  };
}

export function calculateTokenCostUSD(
  modelId: string,
  usage: TokenUsage,
  overrides?: ProviderPricingConfig,
): number {
  return calculateDetailedCostUSD(modelId, usage, overrides).totalCostUSD;
}

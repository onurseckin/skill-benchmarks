import type { ProviderId } from "../providers/types.js";

export type ModelTier = "flagship" | "mid" | "small";

export type ThinkingEffortLevel = "none" | "low" | "medium" | "high" | "max";

export interface ThinkingBudgetConfig {
  readonly supportedLevels: readonly ThinkingEffortLevel[];
  readonly minBudgetTokens: number;
  readonly maxBudgetTokens: number;
  readonly defaultBudgetTokens: number;
  readonly temperatureConstraint?: number;
  readonly requireEqualMaxTokens?: boolean;
}

export interface ModelCapabilities {
  readonly toolCalling: boolean;
  readonly vision: boolean;
  readonly promptCaching: boolean;
  readonly streaming: boolean;
  readonly reasoning: boolean;
  readonly jsonMode: boolean;
  readonly systemPrompt: boolean;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
}

export interface ModelRateCard {
  readonly uncachedInputPerM: number;
  readonly cacheWritePerM: number;
  readonly cacheReadPerM: number;
  readonly standardOutputPerM: number;
  readonly reasoningOutputPerM?: number;
}

export interface NormalizedModelDefinition {
  readonly id: string;
  readonly name: string;
  readonly provider: ProviderId;
  readonly tier: ModelTier;
  readonly capabilities: ModelCapabilities;
  readonly rateCard: ModelRateCard;
  readonly thinkingConfig?: ThinkingBudgetConfig;
  readonly defaultThinkingLevel?: ThinkingEffortLevel;
  readonly description?: string;
}

export interface ModelQueryFilter {
  readonly provider?: ProviderId;
  readonly tier?: ModelTier;
  readonly hasThinking?: boolean;
  readonly hasVision?: boolean;
  readonly hasToolCalling?: boolean;
  readonly hasPromptCaching?: boolean;
  readonly minContextTokens?: number;
}

export interface ProviderThinkingPayload {
  readonly level: ThinkingEffortLevel;
  readonly budgetTokens?: number;
  readonly anthropic?: {
    readonly type: "enabled";
    readonly budget_tokens: number;
  };
  readonly openai?: {
    readonly reasoning_effort: "low" | "medium" | "high";
  };
  readonly gemini?: {
    readonly thinkingConfig: {
      readonly thinkingBudget: number;
    };
  };
}

export interface ThinkingValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
  readonly normalizedBudget?: number;
  readonly normalizedLevel: ThinkingEffortLevel;
}

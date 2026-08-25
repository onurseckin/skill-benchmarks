import type { ProviderId } from "../providers/types.js";
import { CANONICAL_MODELS } from "./canonical-models.js";
import type {
  ModelQueryFilter,
  ModelTier,
  NormalizedModelDefinition,
} from "./types.js";

const dynamicRegistry = new Map<string, NormalizedModelDefinition>(
  Object.entries(CANONICAL_MODELS)
);

export function getModelDefinition(modelId: string): NormalizedModelDefinition | undefined {
  return dynamicRegistry.get(modelId);
}

export function registerModel(model: NormalizedModelDefinition): void {
  dynamicRegistry.set(model.id, model);
}

export function getOrCreateModelDefinition(
  modelId: string,
  provider?: ProviderId
): NormalizedModelDefinition {
  const existing = dynamicRegistry.get(modelId);
  if (existing !== undefined) {
    return existing;
  }

  const inferredProvider: ProviderId =
    provider !== undefined
      ? provider
      : modelId.startsWith("claude")
      ? "anthropic"
      : modelId.startsWith("gpt") || modelId.startsWith("o1") || modelId.startsWith("o3")
      ? "openai"
      : modelId.startsWith("gemini")
      ? "google"
      : "custom";

  const isThinking =
    modelId.includes("thinking") ||
    modelId.startsWith("o1") ||
    modelId.startsWith("o3") ||
    modelId.includes("3-7-sonnet");

  const created: NormalizedModelDefinition = {
    id: modelId,
    name: modelId,
    provider: inferredProvider,
    tier: "mid",
    capabilities: {
      toolCalling: true,
      vision: true,
      promptCaching: true,
      streaming: true,
      reasoning: isThinking,
      jsonMode: true,
      systemPrompt: true,
      contextWindowTokens: 128000,
      maxOutputTokens: 8192,
    },
    rateCard: {
      uncachedInputPerM: 1.0,
      cacheWritePerM: 1.0,
      cacheReadPerM: 0.5,
      standardOutputPerM: 2.0,
      reasoningOutputPerM: isThinking ? 2.0 : undefined,
    },
    thinkingConfig: isThinking
      ? {
          supportedLevels: ["low", "medium", "high"],
          minBudgetTokens: 1024,
          maxBudgetTokens: 32000,
          defaultBudgetTokens: 8000,
        }
      : undefined,
    defaultThinkingLevel: isThinking ? "medium" : undefined,
  };

  dynamicRegistry.set(modelId, created);
  return created;
}

export function listModels(): readonly NormalizedModelDefinition[] {
  return Array.from(dynamicRegistry.values());
}

export function listModelsByTier(tier: ModelTier): readonly NormalizedModelDefinition[] {
  return Array.from(dynamicRegistry.values()).filter((m) => m.tier === tier);
}

export function listModelsByProvider(provider: ProviderId): readonly NormalizedModelDefinition[] {
  return Array.from(dynamicRegistry.values()).filter((m) => m.provider === provider);
}

export function listThinkingModels(): readonly NormalizedModelDefinition[] {
  return Array.from(dynamicRegistry.values()).filter((m) => m.capabilities.reasoning);
}

export function filterModels(filter: ModelQueryFilter): readonly NormalizedModelDefinition[] {
  return Array.from(dynamicRegistry.values()).filter((model) => {
    if (filter.provider !== undefined && model.provider !== filter.provider) return false;
    if (filter.tier !== undefined && model.tier !== filter.tier) return false;
    if (filter.hasThinking !== undefined && model.capabilities.reasoning !== filter.hasThinking) return false;
    if (filter.hasVision !== undefined && model.capabilities.vision !== filter.hasVision) return false;
    if (filter.hasToolCalling !== undefined && model.capabilities.toolCalling !== filter.hasToolCalling) return false;
    if (filter.hasPromptCaching !== undefined && model.capabilities.promptCaching !== filter.hasPromptCaching) return false;
    if (filter.minContextTokens !== undefined && model.capabilities.contextWindowTokens < filter.minContextTokens) return false;
    return true;
  });
}

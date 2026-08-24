import { AnthropicProviderAdapter } from "./anthropic";
import { GeminiProviderAdapter } from "./gemini";
import { OpenAIProviderAdapter } from "./openai";
import {
  LLMProviderAdapter,
  ProviderConfig,
  ProviderError,
  ProviderId,
} from "./types";

export function createProviderAdapter(config: ProviderConfig): LLMProviderAdapter {
  const providerId = config.providerId;

  if (providerId === "anthropic") {
    return new AnthropicProviderAdapter(config.defaultModel, config);
  }

  if (providerId === "google") {
    return new GeminiProviderAdapter(config.defaultModel, config);
  }

  if (providerId === "openai") {
    return new OpenAIProviderAdapter(config.defaultModel, config);
  }

  if (providerId === "ollama") {
    return new OpenAIProviderAdapter(config.defaultModel, config);
  }

  if (providerId === "custom") {
    return new OpenAIProviderAdapter(config.defaultModel, config);
  }

  const safeProviderId: ProviderId = "custom";
  throw new ProviderError(
    `Unsupported provider ID: ${String(providerId)}`,
    safeProviderId
  );
}

export function createAnthropicAdapter(
  modelId?: string,
  config?: Partial<ProviderConfig>
): AnthropicProviderAdapter {
  const baseConfig: Partial<ProviderConfig> = {
    providerId: "anthropic",
    defaultModel: modelId,
  };
  const mergedConfig: Partial<ProviderConfig> =
    config !== undefined ? { ...baseConfig, ...config } : baseConfig;
  return new AnthropicProviderAdapter(modelId, mergedConfig);
}

export function createGeminiAdapter(
  modelId?: string,
  config?: Partial<ProviderConfig>
): GeminiProviderAdapter {
  const baseConfig: Partial<ProviderConfig> = {
    providerId: "google",
    defaultModel: modelId,
  };
  const mergedConfig: Partial<ProviderConfig> =
    config !== undefined ? { ...baseConfig, ...config } : baseConfig;
  return new GeminiProviderAdapter(modelId, mergedConfig);
}

export function createOpenAIAdapter(
  modelId?: string,
  config?: Partial<ProviderConfig>
): OpenAIProviderAdapter {
  const baseConfig: Partial<ProviderConfig> = {
    providerId: "openai",
    defaultModel: modelId,
  };
  const mergedConfig: Partial<ProviderConfig> =
    config !== undefined ? { ...baseConfig, ...config } : baseConfig;
  return new OpenAIProviderAdapter(modelId, mergedConfig);
}

export function createOllamaAdapter(
  modelId?: string,
  config?: Partial<ProviderConfig>
): OpenAIProviderAdapter {
  const defaultBaseUrl = "http://localhost:11434/v1";
  const baseUrl =
    config !== undefined && config.baseUrl !== undefined
      ? config.baseUrl
      : defaultBaseUrl;
  const baseConfig: Partial<ProviderConfig> = {
    providerId: "ollama",
    defaultModel: modelId,
    baseUrl,
  };
  const mergedConfig: Partial<ProviderConfig> =
    config !== undefined ? { ...baseConfig, ...config } : baseConfig;
  return new OpenAIProviderAdapter(modelId, mergedConfig);
}

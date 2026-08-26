import { AnthropicProviderAdapter } from "./anthropic";
import { GeminiProviderAdapter } from "./gemini";
import { MockProviderAdapter } from "./mock-adapter";
import { OpenAIProviderAdapter } from "./openai";
import { LLMProviderAdapter, ProviderConfig, ProviderError, ProviderId } from "./types";

export function createProviderAdapter(config: ProviderConfig): LLMProviderAdapter {
  const normalizedConfig = normalizeProviderConfig(config);
  const providerId = normalizedConfig.providerId;
  const executionMode = normalizedConfig.executionMode ?? "fake";

  if (executionMode === "fake") {
    return new MockProviderAdapter(normalizedConfig.defaultModel, normalizedConfig);
  }

  if (providerId === "anthropic") {
    requireCredential(normalizedConfig, "ANTHROPIC_API_KEY");
    return new AnthropicProviderAdapter(normalizedConfig.defaultModel, normalizedConfig);
  }

  if (providerId === "google") {
    requireCredential(normalizedConfig, "GEMINI_API_KEY", "GOOGLE_API_KEY");
    return new GeminiProviderAdapter(normalizedConfig.defaultModel, normalizedConfig);
  }

  if (providerId === "openai") {
    requireCredential(normalizedConfig, "OPENAI_API_KEY");
    return new OpenAIProviderAdapter(normalizedConfig.defaultModel, normalizedConfig);
  }

  if (providerId === "ollama") {
    if (hasCredential(normalizedConfig.apiKey)) {
      throw new ProviderError("Live Ollama provider does not support API credentials", providerId);
    }
    return new OpenAIProviderAdapter(normalizedConfig.defaultModel, normalizedConfig);
  }

  if (providerId === "custom") {
    throw new ProviderError("Live custom providers are unsupported", providerId);
  }

  const safeProviderId: ProviderId = "custom";
  throw new ProviderError(`Unsupported provider ID: ${String(providerId)}`, safeProviderId);
}

function normalizeProviderConfig(config: ProviderConfig): ProviderConfig {
  return {
    ...config,
    apiKey: hasCredential(config.apiKey) ? config.apiKey : undefined,
    baseUrl: hasCredential(config.baseUrl) ? config.baseUrl : undefined,
  };
}

function hasCredential(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function requireCredential(
  config: ProviderConfig,
  ...environmentNames: ReadonlyArray<string>
): void {
  if (hasCredential(config.apiKey)) {
    return;
  }
  for (const environmentName of environmentNames) {
    if (hasCredential(process.env[environmentName])) {
      return;
    }
  }
  throw new ProviderError(
    `Live ${config.providerId} provider requires ${environmentNames.join(" or ")}`,
    config.providerId,
  );
}

export function createAnthropicAdapter(
  modelId?: string,
  config?: Partial<ProviderConfig>,
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
  config?: Partial<ProviderConfig>,
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
  config?: Partial<ProviderConfig>,
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
  config?: Partial<ProviderConfig>,
): OpenAIProviderAdapter {
  const defaultBaseUrl = "http://localhost:11434/v1";
  const baseUrl =
    config !== undefined && config.baseUrl !== undefined ? config.baseUrl : defaultBaseUrl;
  const baseConfig: Partial<ProviderConfig> = {
    providerId: "ollama",
    defaultModel: modelId,
    baseUrl,
  };
  const mergedConfig: Partial<ProviderConfig> =
    config !== undefined ? { ...baseConfig, ...config } : baseConfig;
  return new OpenAIProviderAdapter(modelId, mergedConfig);
}

export function createMockAdapter(
  modelId?: string,
  config?: Partial<ProviderConfig>,
): MockProviderAdapter {
  const baseConfig: Partial<ProviderConfig> = {
    providerId: "custom",
    defaultModel: modelId,
  };
  const mergedConfig: Partial<ProviderConfig> =
    config !== undefined ? { ...baseConfig, ...config } : baseConfig;
  return new MockProviderAdapter(modelId, mergedConfig);
}

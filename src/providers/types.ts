import type { ExecutionMode } from "../shared/execution-mode";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export type FinishReason = "stop" | "tool_calls" | "length" | "content_filter" | "error";

export type ProviderId = "anthropic" | "openai" | "google" | "ollama" | "custom";

export interface TextContentPart {
  readonly type: "text";
  readonly text: string;
}

export interface ImageContentPart {
  readonly type: "image";
  readonly mimeType: string;
  readonly data: string;
}

export interface ToolCallContentPart {
  readonly type: "tool_call";
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface ToolResultContentPart {
  readonly type: "tool_result";
  readonly toolCallId: string;
  readonly output: string;
  readonly isError?: boolean;
}

export type AgentMessageContentPart =
  | TextContentPart
  | ImageContentPart
  | ToolCallContentPart
  | ToolResultContentPart;

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly rawArguments: string;
}

export interface ToolCallResult {
  readonly toolCallId: string;
  readonly output: string;
  readonly isError?: boolean;
  readonly executionTimeMs?: number;
}

export interface ToolCallDelta {
  readonly index: number;
  readonly id?: string;
  readonly name?: string;
  readonly argumentsDelta?: string;
}

export interface AgentMessage {
  readonly role: MessageRole;
  readonly content: string | readonly AgentMessageContentPart[];
  readonly name?: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ToolCallRequest[];
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly totalTokens: number;
  readonly reasoningOutputTokens?: number;
}

export interface DetailedTokenTelemetry {
  readonly uncachedInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly totalInputTokens: number;
  readonly completionOutputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalOutputTokens: number;
  readonly grandTotalTokens: number;
}

export interface CompletionChunk {
  readonly textDelta?: string;
  readonly reasoningDelta?: string;
  readonly toolCallDeltas?: ReadonlyArray<ToolCallDelta>;
  readonly finishReason?: FinishReason;
  readonly usage?: TokenUsage;
}

export interface ModelTurnResponse {
  readonly text: string;
  readonly reasoningText?: string;
  readonly toolCalls: ReadonlyArray<ToolCallRequest>;
  readonly finishReason: FinishReason;
  readonly usage: TokenUsage;
  readonly timeToFirstTokenMs: number;
  readonly totalTurnDurationMs: number;
  readonly rawResponseHeaders?: Readonly<Record<string, string>>;
}

export interface GenerateOptions {
  readonly temperature: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly stopSequences?: ReadonlyArray<string>;
  readonly signal?: AbortSignal;
  readonly customHeaders?: Readonly<Record<string, string>>;
  readonly thinkingBudgetTokens?: number;
  readonly thinkingEffortLevel?: "none" | "low" | "medium" | "high" | "max";
  readonly reasoningEffort?: "low" | "medium" | "high";
  readonly responseFormat?: { readonly type: "text" | "json_object" };
}

export interface ModelConfig {
  readonly modelId: string;
  readonly providerId: ProviderId;
  readonly contextWindowTokens?: number;
  readonly maxOutputTokens?: number;
  readonly supportsStreaming?: boolean;
  readonly supportsPromptCaching?: boolean;
  readonly supportsThinkingTokens?: boolean;
  readonly supportsToolCalling?: boolean;
}

export interface ProviderConfig {
  readonly executionMode?: ExecutionMode;
  readonly runId?: string;
  readonly providerId: ProviderId;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly organization?: string;
  readonly defaultModel?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly customHeaders?: Readonly<Record<string, string>>;
}

export interface ModelPricingRate {
  readonly uncachedInputPerM: number;
  readonly cacheWritePerM: number;
  readonly cacheReadPerM: number;
  readonly standardOutputPerM: number;
  readonly reasoningOutputPerM?: number;
}

export type ProviderPricingConfig = Readonly<Record<string, ModelPricingRate>>;

export interface LLMProviderAdapter {
  readonly providerId: ProviderId;
  readonly modelId: string;
  readonly executionMode?: ExecutionMode;
  readonly simulated?: boolean;
  generateStream(
    messages: ReadonlyArray<AgentMessage>,
    tools: ReadonlyArray<ToolDefinition>,
    options: GenerateOptions
  ): AsyncIterable<CompletionChunk>;
  generateTurn(
    messages: ReadonlyArray<AgentMessage>,
    tools: ReadonlyArray<ToolDefinition>,
    options: GenerateOptions
  ): Promise<ModelTurnResponse>;
  calculateCostUSD(usage: TokenUsage): number;
}

export class ProviderError extends Error {
  public readonly providerId: ProviderId;
  public readonly statusCode?: number;
  public readonly isRetryable: boolean;
  public readonly rawError?: unknown;

  constructor(
    message: string,
    providerId: ProviderId,
    options?: {
      readonly statusCode?: number;
      readonly isRetryable?: boolean;
      readonly cause?: unknown;
      readonly rawError?: unknown;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.providerId = providerId;
    this.statusCode = options?.statusCode;
    this.isRetryable = options !== undefined && options.isRetryable !== undefined ? options.isRetryable : false;
    this.rawError = options?.rawError;
  }
}

export class ProviderRateLimitError extends ProviderError {
  public readonly retryAfterMs?: number;

  constructor(
    message: string,
    providerId: ProviderId,
    options?: {
      readonly statusCode?: number;
      readonly retryAfterMs?: number;
      readonly cause?: unknown;
      readonly rawError?: unknown;
    }
  ) {
    super(message, providerId, {
      statusCode: options !== undefined && options.statusCode !== undefined ? options.statusCode : 429,
      isRetryable: true,
      cause: options?.cause,
      rawError: options?.rawError,
    });
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export class ProviderAuthenticationError extends ProviderError {
  constructor(
    message: string,
    providerId: ProviderId,
    options?: {
      readonly statusCode?: number;
      readonly cause?: unknown;
      readonly rawError?: unknown;
    }
  ) {
    super(message, providerId, {
      statusCode: options !== undefined && options.statusCode !== undefined ? options.statusCode : 401,
      isRetryable: false,
      cause: options?.cause,
      rawError: options?.rawError,
    });
  }
}

export class ProviderContextLengthExceededError extends ProviderError {
  public readonly contextLimit?: number;
  public readonly requestedTokens?: number;

  constructor(
    message: string,
    providerId: ProviderId,
    options?: {
      readonly statusCode?: number;
      readonly contextLimit?: number;
      readonly requestedTokens?: number;
      readonly cause?: unknown;
      readonly rawError?: unknown;
    }
  ) {
    super(message, providerId, {
      statusCode: options !== undefined && options.statusCode !== undefined ? options.statusCode : 400,
      isRetryable: false,
      cause: options?.cause,
      rawError: options?.rawError,
    });
    this.contextLimit = options?.contextLimit;
    this.requestedTokens = options?.requestedTokens;
  }
}

export class ProviderTimeoutError extends ProviderError {
  public readonly timeoutMs?: number;

  constructor(
    message: string,
    providerId: ProviderId,
    options?: {
      readonly statusCode?: number;
      readonly timeoutMs?: number;
      readonly cause?: unknown;
      readonly rawError?: unknown;
    }
  ) {
    super(message, providerId, {
      statusCode: options !== undefined && options.statusCode !== undefined ? options.statusCode : 408,
      isRetryable: true,
      cause: options?.cause,
      rawError: options?.rawError,
    });
    this.timeoutMs = options?.timeoutMs;
  }
}

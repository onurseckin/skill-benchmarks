import { calculateTokenCostUSD } from "./pricing";
import {
  AgentMessage,
  AgentMessageContentPart,
  CompletionChunk,
  FinishReason,
  GenerateOptions,
  LLMProviderAdapter,
  ModelTurnResponse,
  ProviderAuthenticationError,
  ProviderConfig,
  ProviderContextLengthExceededError,
  ProviderError,
  ProviderId,
  ProviderRateLimitError,
  ProviderTimeoutError,
  TokenUsage,
  ToolCallDelta,
  ToolCallRequest,
  ToolDefinition,
} from "./types";

interface OpenAIChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | readonly unknown[] | null;
  readonly tool_calls?: readonly {
    readonly id: string;
    readonly type: "function";
    readonly function: { readonly name: string; readonly arguments: string };
  }[];
  readonly tool_call_id?: string;
  readonly name?: string;
}

interface OpenAIToolCallPayload {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

interface OpenAIChoice {
  readonly index: number;
  readonly message?: {
    readonly role: string;
    readonly content: string | null;
    readonly tool_calls?: readonly OpenAIToolCallPayload[];
  };
  readonly delta?: {
    readonly role?: string;
    readonly content?: string | null;
    readonly reasoning_content?: string | null;
    readonly tool_calls?: readonly {
      readonly index: number;
      readonly id?: string;
      readonly function?: { readonly name?: string; readonly arguments?: string };
    }[];
  };
  readonly finish_reason: string | null;
}

interface OpenAIUsageResponse {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
  readonly prompt_tokens_details?: { readonly cached_tokens?: number };
  readonly completion_tokens_details?: { readonly reasoning_tokens?: number };
}

interface OpenAIResponsePayload {
  readonly id?: string;
  readonly choices?: readonly OpenAIChoice[];
  readonly usage?: OpenAIUsageResponse;
  readonly error?: { readonly message?: string; readonly type?: string; readonly code?: string };
}

function mapOpenAIFinishReason(reason: string | null | undefined): FinishReason {
  if (reason === "stop") return "stop";
  if (reason === "tool_calls") return "tool_calls";
  if (reason === "length") return "length";
  if (reason === "content_filter") return "content_filter";
  return "stop";
}

function parseOpenAIError(status: number, message: string, raw: unknown, providerId: ProviderId): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderAuthenticationError(message, providerId, { statusCode: status, rawError: raw });
  }
  if (status === 429) {
    return new ProviderRateLimitError(message, providerId, { statusCode: status, rawError: raw });
  }
  if (status === 400 && (message.includes("maximum context length") || message.includes("tokens"))) {
    return new ProviderContextLengthExceededError(message, providerId, { statusCode: status, rawError: raw });
  }
  if (status === 408 || status === 504) {
    return new ProviderTimeoutError(message, providerId, { statusCode: status, rawError: raw });
  }
  return new ProviderError(message, providerId, { statusCode: status, isRetryable: status >= 500, rawError: raw });
}

function convertPartsToOpenAIContent(parts: readonly AgentMessageContentPart[]): readonly unknown[] {
  const openAIParts: unknown[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      openAIParts.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      openAIParts.push({ type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } });
    }
  }
  return openAIParts;
}

export class OpenAIProviderAdapter implements LLMProviderAdapter {
  public readonly providerId: ProviderId;
  public readonly modelId: string;
  private readonly config: ProviderConfig;

  constructor(modelId?: string, config?: Partial<ProviderConfig>) {
    this.providerId = config !== undefined && config.providerId !== undefined ? config.providerId : "openai";
    this.modelId = modelId !== undefined && modelId.length > 0 ? modelId : "gpt-4o";
    const defaultBaseUrl = this.providerId === "ollama" ? "http://localhost:11434/v1" : "https://api.openai.com/v1";
    this.config = {
      providerId: this.providerId,
      apiKey: config !== undefined && config.apiKey !== undefined ? config.apiKey : this.providerId === "openai" ? process.env.OPENAI_API_KEY : "dummy-key",
      baseUrl: config !== undefined && config.baseUrl !== undefined ? config.baseUrl : defaultBaseUrl,
      timeoutMs: config !== undefined && config.timeoutMs !== undefined ? config.timeoutMs : 60000,
      maxRetries: config !== undefined && config.maxRetries !== undefined ? config.maxRetries : 2,
      customHeaders: config !== undefined ? config.customHeaders : undefined,
      defaultModel: this.modelId,
    };
  }

  public calculateCostUSD(usage: TokenUsage): number {
    return calculateTokenCostUSD(this.modelId, usage);
  }

  private buildPayload(
    messages: ReadonlyArray<AgentMessage>,
    tools: ReadonlyArray<ToolDefinition>,
    options: GenerateOptions,
    stream: boolean
  ): { readonly url: string; readonly headers: Record<string, string>; readonly body: string } {
    const rawBase = this.config.baseUrl !== undefined ? this.config.baseUrl : "https://api.openai.com/v1";
    const cleanBase = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;
    const url = `${cleanBase}/chat/completions`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${this.config.apiKey !== undefined ? this.config.apiKey : ""}`,
    };
    if (this.config.organization !== undefined) headers["openai-organization"] = this.config.organization;
    if (this.config.customHeaders !== undefined) {
      for (const [k, v] of Object.entries(this.config.customHeaders)) headers[k] = v;
    }
    if (options.customHeaders !== undefined) {
      for (const [k, v] of Object.entries(options.customHeaders)) headers[k] = v;
    }

    const openAIMessages: OpenAIChatMessage[] = [];
    for (const msg of messages) {
      if (msg.role === "system") {
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        openAIMessages.push({ role: "system", content });
      } else if (msg.role === "user") {
        const content = typeof msg.content === "string" ? msg.content : convertPartsToOpenAIContent(msg.content);
        openAIMessages.push({ role: "user", content });
      } else if (msg.role === "assistant") {
        if (msg.toolCalls !== undefined && msg.toolCalls.length > 0) {
          const tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.rawArguments },
          }));
          openAIMessages.push({ role: "assistant", content: typeof msg.content === "string" ? msg.content : null, tool_calls });
        } else {
          const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
          openAIMessages.push({ role: "assistant", content });
        }
      } else if (msg.role === "tool") {
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        openAIMessages.push({ role: "tool", content, tool_call_id: msg.toolCallId !== undefined ? msg.toolCallId : "call_default" });
      }
    }

    const openAITools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const isReasoningModel = this.modelId.startsWith("o1") || this.modelId.startsWith("o3");
    const bodyObj: Record<string, unknown> = {
      model: this.modelId,
      messages: openAIMessages,
      stream,
    };
    if (!isReasoningModel) {
      bodyObj.temperature = options.temperature;
    }
    if (stream) bodyObj.stream_options = { include_usage: true };
    if (options.maxTokens !== undefined) {
      if (isReasoningModel) {
        bodyObj.max_completion_tokens = options.maxTokens;
      } else {
        bodyObj.max_tokens = options.maxTokens;
      }
    }
    if (options.reasoningEffort !== undefined) {
      bodyObj.reasoning_effort = options.reasoningEffort;
    } else if (options.thinkingEffortLevel !== undefined && options.thinkingEffortLevel !== "none") {
      bodyObj.reasoning_effort = options.thinkingEffortLevel === "high" || options.thinkingEffortLevel === "max" ? "high" : options.thinkingEffortLevel === "low" ? "low" : "medium";
    }
    if (options.topP !== undefined && !isReasoningModel) bodyObj.top_p = options.topP;
    if (options.stopSequences !== undefined && options.stopSequences.length > 0) bodyObj.stop = options.stopSequences;
    if (openAITools.length > 0) bodyObj.tools = openAITools;
    if (options.responseFormat !== undefined) bodyObj.response_format = options.responseFormat;

    return { url, headers, body: JSON.stringify(bodyObj) };
  }

  public async *generateStream(
    messages: ReadonlyArray<AgentMessage>,
    tools: ReadonlyArray<ToolDefinition>,
    options: GenerateOptions
  ): AsyncIterable<CompletionChunk> {
    const { url, headers, body } = this.buildPayload(messages, tools, options, true);
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers, body, signal: options.signal });
    } catch (err: unknown) {
      throw new ProviderError(
        `OpenAI network failure: ${err instanceof Error ? err.message : String(err)}`,
        this.providerId,
        { cause: err, isRetryable: true }
      );
    }

    if (!response.ok) {
      const rawText = await response.text().catch(() => "");
      let errMsg = `OpenAI API error ${response.status}`;
      try {
        const parsed = JSON.parse(rawText) as { readonly error?: { readonly message?: string } };
        if (parsed.error !== undefined && parsed.error.message !== undefined) errMsg = parsed.error.message;
      } catch {
        if (rawText.length > 0) errMsg = rawText;
      }
      throw parseOpenAIError(response.status, errMsg, rawText, this.providerId);
    }

    if (response.body === null) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() !== undefined ? (lines.pop() as string) : "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") return;
          try {
            const payload = JSON.parse(dataStr) as OpenAIResponsePayload;
            if (payload.choices !== undefined && payload.choices.length > 0) {
              const choice = payload.choices[0];
              if (choice !== undefined) {
                const delta = choice.delta;
                if (delta !== undefined) {
                  if (delta.content !== null && delta.content !== undefined) yield { textDelta: delta.content };
                  if (delta.reasoning_content !== null && delta.reasoning_content !== undefined) {
                    yield { reasoningDelta: delta.reasoning_content };
                  }
                  if (delta.tool_calls !== undefined && delta.tool_calls.length > 0) {
                    const toolCallDeltas: ToolCallDelta[] = delta.tool_calls.map((tc) => ({
                      index: tc.index,
                      id: tc.id,
                      name: tc.function !== undefined ? tc.function.name : undefined,
                      argumentsDelta: tc.function !== undefined ? tc.function.arguments : undefined,
                    }));
                    yield { toolCallDeltas };
                  }
                }
                if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
                  yield { finishReason: mapOpenAIFinishReason(choice.finish_reason) };
                }
              }
            }
          } catch {
            continue;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  public async generateTurn(
    messages: ReadonlyArray<AgentMessage>,
    tools: ReadonlyArray<ToolDefinition>,
    options: GenerateOptions
  ): Promise<ModelTurnResponse> {
    const startTime = Date.now();
    const { url, headers, body } = this.buildPayload(messages, tools, options, false);
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers, body, signal: options.signal });
    } catch (err: unknown) {
      throw new ProviderError(
        `OpenAI network failure: ${err instanceof Error ? err.message : String(err)}`,
        this.providerId,
        { cause: err, isRetryable: true }
      );
    }

    const duration = Date.now() - startTime;
    if (!response.ok) {
      const rawText = await response.text().catch(() => "");
      let errMsg = `OpenAI API error ${response.status}`;
      try {
        const parsed = JSON.parse(rawText) as { readonly error?: { readonly message?: string } };
        if (parsed.error !== undefined && parsed.error.message !== undefined) errMsg = parsed.error.message;
      } catch {
        if (rawText.length > 0) errMsg = rawText;
      }
      throw parseOpenAIError(response.status, errMsg, rawText, this.providerId);
    }

    const payload = (await response.json()) as OpenAIResponsePayload;
    let fullText = "";
    const toolCalls: ToolCallRequest[] = [];
    let finishReason: FinishReason = "stop";

    if (payload.choices !== undefined && payload.choices.length > 0) {
      const choice = payload.choices[0];
      if (choice !== undefined) {
        finishReason = mapOpenAIFinishReason(choice.finish_reason);
        if (choice.message !== undefined) {
          if (choice.message.content !== null && choice.message.content !== undefined) fullText = choice.message.content;
          if (choice.message.tool_calls !== undefined) {
            for (const tc of choice.message.tool_calls) {
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
              } catch {
                parsedArgs = {};
              }
              toolCalls.push({ id: tc.id, name: tc.function.name, arguments: parsedArgs, rawArguments: tc.function.arguments });
            }
          }
        }
      }
    }

    const usageResp = payload.usage;
    const inputTokens = usageResp !== undefined && usageResp.prompt_tokens !== undefined ? usageResp.prompt_tokens : 0;
    const outputTokens = usageResp !== undefined && usageResp.completion_tokens !== undefined ? usageResp.completion_tokens : 0;
    const cacheReadInputTokens =
      usageResp !== undefined && usageResp.prompt_tokens_details !== undefined && usageResp.prompt_tokens_details.cached_tokens !== undefined
        ? usageResp.prompt_tokens_details.cached_tokens
        : 0;
    const reasoningOutputTokens =
      usageResp !== undefined && usageResp.completion_tokens_details !== undefined && usageResp.completion_tokens_details.reasoning_tokens !== undefined
        ? usageResp.completion_tokens_details.reasoning_tokens
        : 0;

    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens,
      reasoningOutputTokens,
      totalTokens: inputTokens + outputTokens,
    };

    return {
      text: fullText,
      toolCalls,
      finishReason,
      usage,
      timeToFirstTokenMs: duration,
      totalTurnDurationMs: duration,
    };
  }
}

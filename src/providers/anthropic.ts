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
  ToolCallRequest,
  ToolDefinition,
} from "./types";

interface AnthropicContentBlock {
  readonly type: "text" | "image" | "tool_use" | "tool_result";
  readonly text?: string;
  readonly source?: { readonly type: "base64"; readonly media_type: string; readonly data: string };
  readonly id?: string;
  readonly name?: string;
  readonly input?: Readonly<Record<string, unknown>>;
  readonly tool_use_id?: string;
  readonly content?: string;
  readonly is_error?: boolean;
  readonly cache_control?: { readonly type: "ephemeral" };
}

interface AnthropicWireMessage {
  readonly role: "user" | "assistant";
  readonly content: string | readonly AnthropicContentBlock[];
}

interface AnthropicToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Readonly<Record<string, unknown>>;
  readonly cache_control?: { readonly type: "ephemeral" };
}

interface AnthropicUsageResponse {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

interface AnthropicResponsePayload {
  readonly id?: string;
  readonly type?: string;
  readonly role?: string;
  readonly content?: readonly AnthropicContentBlock[];
  readonly stop_reason?: string | null;
  readonly usage?: AnthropicUsageResponse;
  readonly error?: { readonly type?: string; readonly message?: string };
}

function mapFinishReason(stopReason: string | null | undefined): FinishReason {
  if (stopReason === "end_turn" || stopReason === "stop_sequence") return "stop";
  if (stopReason === "tool_use") return "tool_calls";
  if (stopReason === "max_tokens") return "length";
  if (stopReason === "content_filter") return "content_filter";
  return "stop";
}

function parseAnthropicError(
  status: number,
  errorType: string,
  message: string,
  raw: unknown
): ProviderError {
  if (status === 401 || status === 403 || errorType === "authentication_error") {
    return new ProviderAuthenticationError(message, "anthropic", { statusCode: status, rawError: raw });
  }
  if (status === 429 || errorType === "rate_limit_error") {
    return new ProviderRateLimitError(message, "anthropic", { statusCode: status, rawError: raw });
  }
  if (status === 400 && (errorType === "invalid_request_error" || message.includes("prompt is too long"))) {
    return new ProviderContextLengthExceededError(message, "anthropic", { statusCode: status, rawError: raw });
  }
  if (status === 408 || status === 504 || errorType === "timeout") {
    return new ProviderTimeoutError(message, "anthropic", { statusCode: status, rawError: raw });
  }
  return new ProviderError(message, "anthropic", {
    statusCode: status,
    isRetryable: status >= 500,
    rawError: raw,
  });
}

function convertPartsToAnthropicBlocks(
  parts: readonly AgentMessageContentPart[]
): readonly AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      blocks.push({ type: "image", source: { type: "base64", media_type: part.mimeType, data: part.data } });
    } else if (part.type === "tool_call") {
      blocks.push({ type: "tool_use", id: part.id, name: part.name, input: part.arguments });
    } else if (part.type === "tool_result") {
      blocks.push({ type: "tool_result", tool_use_id: part.toolCallId, content: part.output, is_error: part.isError });
    }
  }
  return blocks;
}

export class AnthropicProviderAdapter implements LLMProviderAdapter {
  public readonly providerId: ProviderId = "anthropic";
  public readonly modelId: string;
  private readonly config: ProviderConfig;

  constructor(modelId?: string, config?: Partial<ProviderConfig>) {
    this.modelId = modelId !== undefined && modelId.length > 0 ? modelId : "claude-3-5-sonnet-20241022";
    this.config = {
      providerId: "anthropic",
      apiKey: config !== undefined && config.apiKey !== undefined ? config.apiKey : process.env.ANTHROPIC_API_KEY,
      baseUrl: config !== undefined && config.baseUrl !== undefined ? config.baseUrl : "https://api.anthropic.com/v1",
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
    const rawBase = this.config.baseUrl !== undefined ? this.config.baseUrl : "https://api.anthropic.com/v1";
    const endpoint = rawBase.endsWith("/") ? `${rawBase}messages` : `${rawBase}/messages`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-api-key": this.config.apiKey !== undefined ? this.config.apiKey : "",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31,output-128k-2025-02-19",
    };
    if (this.config.customHeaders !== undefined) {
      for (const [k, v] of Object.entries(this.config.customHeaders)) headers[k] = v;
    }
    if (options.customHeaders !== undefined) {
      for (const [k, v] of Object.entries(options.customHeaders)) headers[k] = v;
    }

    let systemContent: AnthropicContentBlock[] | undefined = undefined;
    const wireMessages: AnthropicWireMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        systemContent = [{ type: "text", text, cache_control: { type: "ephemeral" } }];
      } else if (msg.role === "user" || msg.role === "tool") {
        const content = typeof msg.content === "string" ? msg.content : convertPartsToAnthropicBlocks(msg.content);
        wireMessages.push({ role: "user", content });
      } else if (msg.role === "assistant") {
        const content = typeof msg.content === "string" ? msg.content : convertPartsToAnthropicBlocks(msg.content);
        wireMessages.push({ role: "assistant", content });
      }
    }

    const anthropicTools: AnthropicToolDeclaration[] = tools.map((t, idx) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
      cache_control: idx === tools.length - 1 ? { type: "ephemeral" } : undefined,
    }));

    const maxTokens = options.maxTokens !== undefined ? options.maxTokens : 4096;
    const bodyObj: Record<string, unknown> = {
      model: this.modelId,
      messages: wireMessages,
      max_tokens: maxTokens,
      temperature: options.temperature,
      stream,
    };

    if (systemContent !== undefined && systemContent.length > 0) bodyObj.system = systemContent;
    if (anthropicTools.length > 0) bodyObj.tools = anthropicTools;
    if (options.topP !== undefined) bodyObj.top_p = options.topP;
    if (options.stopSequences !== undefined && options.stopSequences.length > 0) {
      bodyObj.stop_sequences = options.stopSequences;
    }
    if (options.thinkingBudgetTokens !== undefined && options.thinkingBudgetTokens > 0) {
      bodyObj.thinking = { type: "enabled", budget_tokens: options.thinkingBudgetTokens };
    }

    return { url: endpoint, headers, body: JSON.stringify(bodyObj) };
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
        `Anthropic network failure: ${err instanceof Error ? err.message : String(err)}`,
        "anthropic",
        { cause: err, isRetryable: true }
      );
    }

    if (!response.ok) {
      const rawText = await response.text().catch(() => "");
      let errType = "unknown";
      let errMsg = `Anthropic API error ${response.status}`;
      try {
        const parsed = JSON.parse(rawText) as { readonly error?: { readonly type?: string; readonly message?: string } };
        if (parsed.error !== undefined) {
          if (parsed.error.type !== undefined) errType = parsed.error.type;
          if (parsed.error.message !== undefined) errMsg = parsed.error.message;
        }
      } catch {
        if (rawText.length > 0) errMsg = rawText;
      }
      throw parseAnthropicError(response.status, errType, errMsg, rawText);
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
        const lastLine = lines.pop();
        buffer = lastLine !== undefined ? lastLine : "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") return;
          try {
            const event = JSON.parse(dataStr) as {
              readonly type?: string;
              readonly delta?: { readonly type?: string; readonly text?: string; readonly thinking?: string; readonly stop_reason?: string | null };
            };
            if (event.type === "content_block_delta" && event.delta !== undefined) {
              if (event.delta.type === "text_delta" && event.delta.text !== undefined) {
                yield { textDelta: event.delta.text };
              } else if (event.delta.type === "thinking_delta" && event.delta.thinking !== undefined) {
                yield { reasoningDelta: event.delta.thinking };
              }
            } else if (event.type === "message_delta") {
              const finishReason = event.delta !== undefined && event.delta.stop_reason !== undefined
                ? mapFinishReason(event.delta.stop_reason)
                : undefined;
              yield { finishReason };
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
        `Anthropic network failure: ${err instanceof Error ? err.message : String(err)}`,
        "anthropic",
        { cause: err, isRetryable: true }
      );
    }

    const duration = Date.now() - startTime;
    if (!response.ok) {
      const rawText = await response.text().catch(() => "");
      let errType = "unknown";
      let errMsg = `Anthropic API error ${response.status}`;
      try {
        const parsed = JSON.parse(rawText) as { readonly error?: { readonly type?: string; readonly message?: string } };
        if (parsed.error !== undefined) {
          if (parsed.error.type !== undefined) errType = parsed.error.type;
          if (parsed.error.message !== undefined) errMsg = parsed.error.message;
        }
      } catch {
        if (rawText.length > 0) errMsg = rawText;
      }
      throw parseAnthropicError(response.status, errType, errMsg, rawText);
    }

    const payload = (await response.json()) as AnthropicResponsePayload;
    let fullText = "";
    const toolCalls: ToolCallRequest[] = [];

    if (payload.content !== undefined) {
      for (const block of payload.content) {
        if (block.type === "text" && block.text !== undefined) {
          fullText += block.text;
        } else if (block.type === "tool_use" && block.id !== undefined && block.name !== undefined && block.input !== undefined) {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input,
            rawArguments: JSON.stringify(block.input),
          });
        }
      }
    }

    const usageResp = payload.usage;
    const inputTokens = usageResp !== undefined && usageResp.input_tokens !== undefined ? usageResp.input_tokens : 0;
    const outputTokens = usageResp !== undefined && usageResp.output_tokens !== undefined ? usageResp.output_tokens : 0;
    const cacheCreationInputTokens =
      usageResp !== undefined && usageResp.cache_creation_input_tokens !== undefined
        ? usageResp.cache_creation_input_tokens
        : 0;
    const cacheReadInputTokens =
      usageResp !== undefined && usageResp.cache_read_input_tokens !== undefined
        ? usageResp.cache_read_input_tokens
        : 0;

    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
    };

    return {
      text: fullText,
      toolCalls,
      finishReason: mapFinishReason(payload.stop_reason),
      usage,
      timeToFirstTokenMs: duration,
      totalTurnDurationMs: duration,
    };
  }
}

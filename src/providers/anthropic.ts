import { calculateTokenCostUSD } from "./pricing";
import {
  convertPartsToAnthropicBlocks,
  mapAnthropicFinishReason as mapFinishReason,
  parseAnthropicError,
  type AnthropicContentBlock,
  type AnthropicResponsePayload,
  type AnthropicToolDeclaration,
  type AnthropicWireMessage,
} from "./anthropic-protocol.js";
import { executeProviderRequest } from "./transport/request-executor.js";
import {
  AgentMessage,
  CompletionChunk,
  GenerateOptions,
  LLMProviderAdapter,
  ModelTurnResponse,
  ProviderConfig,
  ProviderId,
  TokenUsage,
  ToolCallRequest,
  ToolDefinition,
} from "./types";

function parseAnthropicResponseError(response: Response, rawText: string) {
  let errorType = "unknown";
  let errorMessage = `Anthropic API error ${response.status}`;
  try {
    const parsed = JSON.parse(rawText) as {
      readonly error?: { readonly type?: string; readonly message?: string };
    };
    if (parsed.error !== undefined) {
      if (parsed.error.type !== undefined) errorType = parsed.error.type;
      if (parsed.error.message !== undefined) errorMessage = parsed.error.message;
    }
  } catch {
    if (rawText.length > 0) errorMessage = rawText;
  }
  return parseAnthropicError(response.status, errorType, errorMessage, rawText);
}

export class AnthropicProviderAdapter implements LLMProviderAdapter {
  public readonly providerId: ProviderId = "anthropic";
  public readonly modelId: string;
  private readonly config: ProviderConfig;

  constructor(modelId?: string, config?: Partial<ProviderConfig>) {
    this.modelId =
      modelId !== undefined && modelId.length > 0 ? modelId : "claude-3-5-sonnet-20241022";
    this.config = {
      providerId: "anthropic",
      apiKey:
        config !== undefined && config.apiKey !== undefined
          ? config.apiKey
          : process.env.ANTHROPIC_API_KEY,
      baseUrl:
        config !== undefined && config.baseUrl !== undefined
          ? config.baseUrl
          : "https://api.anthropic.com/v1",
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
    stream: boolean,
  ): { readonly url: string; readonly headers: Record<string, string>; readonly body: string } {
    const rawBase =
      this.config.baseUrl !== undefined ? this.config.baseUrl : "https://api.anthropic.com/v1";
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
        const content =
          typeof msg.content === "string"
            ? msg.content
            : convertPartsToAnthropicBlocks(msg.content);
        wireMessages.push({ role: "user", content });
      } else if (msg.role === "assistant") {
        const content =
          typeof msg.content === "string"
            ? msg.content
            : convertPartsToAnthropicBlocks(msg.content);
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
    options: GenerateOptions,
  ): AsyncIterable<CompletionChunk> {
    const { url, headers, body } = this.buildPayload(messages, tools, options, true);
    const response = await executeProviderRequest({
      providerId: "anthropic",
      url,
      headers,
      body,
      timeoutMs: this.config.timeoutMs ?? 60_000,
      maxRetries: this.config.maxRetries ?? 2,
      responseMode: "stream",
      callerSignal: options.signal,
      parseError: parseAnthropicResponseError,
    });

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
              readonly delta?: {
                readonly type?: string;
                readonly text?: string;
                readonly thinking?: string;
                readonly stop_reason?: string | null;
              };
            };
            if (event.type === "content_block_delta" && event.delta !== undefined) {
              if (event.delta.type === "text_delta" && event.delta.text !== undefined) {
                yield { textDelta: event.delta.text };
              } else if (
                event.delta.type === "thinking_delta" &&
                event.delta.thinking !== undefined
              ) {
                yield { reasoningDelta: event.delta.thinking };
              }
            } else if (event.type === "message_delta") {
              const finishReason =
                event.delta !== undefined && event.delta.stop_reason !== undefined
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
    options: GenerateOptions,
  ): Promise<ModelTurnResponse> {
    const startTime = Date.now();
    const { url, headers, body } = this.buildPayload(messages, tools, options, false);
    const response = await executeProviderRequest({
      providerId: "anthropic",
      url,
      headers,
      body,
      timeoutMs: this.config.timeoutMs ?? 60_000,
      maxRetries: this.config.maxRetries ?? 2,
      responseMode: "buffered",
      callerSignal: options.signal,
      parseError: parseAnthropicResponseError,
    });
    const duration = Date.now() - startTime;

    const payload = (await response.json()) as AnthropicResponsePayload;
    let fullText = "";
    const toolCalls: ToolCallRequest[] = [];

    if (payload.content !== undefined) {
      for (const block of payload.content) {
        if (block.type === "text" && block.text !== undefined) {
          fullText += block.text;
        } else if (
          block.type === "tool_use" &&
          block.id !== undefined &&
          block.name !== undefined &&
          block.input !== undefined
        ) {
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
    const inputTokens =
      usageResp !== undefined && usageResp.input_tokens !== undefined ? usageResp.input_tokens : 0;
    const outputTokens =
      usageResp !== undefined && usageResp.output_tokens !== undefined
        ? usageResp.output_tokens
        : 0;
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

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
  consumeProviderTurnResponse,
  finalizeProviderStream,
  readProviderStreamChunk,
} from "./transport/response-lifecycle.js";
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
      permitSource: config?.permitSource,
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
    const responseLease = await executeProviderRequest({
      providerId: "anthropic",
      url,
      headers,
      body,
      timeoutMs: this.config.timeoutMs ?? 60_000,
      maxRetries: this.config.maxRetries ?? 2,
      responseMode: "stream",
      callerSignal: options.signal,
      permitSource: this.config.permitSource,
      parseError: parseAnthropicResponseError,
    });

    const response = responseLease.response;
    if (response.body === null) {
      await responseLease.complete();
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let completed = false;
    let usage = createEmptyTokenUsage();
    let actualTokens: number | undefined;
    let failure: Error | undefined;

    try {
      while (true) {
        const { done, value } = await readProviderStreamChunk(responseLease, reader);
        if (done) {
          completed = true;
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        const lastLine = lines.pop();
        buffer = lastLine !== undefined ? lastLine : "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") {
            completed = true;
            return;
          }
          try {
            const event = JSON.parse(dataStr) as {
              readonly type?: string;
              readonly delta?: {
                readonly type?: string;
                readonly text?: string;
                readonly thinking?: string;
                readonly stop_reason?: string | null;
              };
              readonly message?: { readonly usage?: AnthropicResponsePayload["usage"] };
              readonly usage?: AnthropicResponsePayload["usage"];
            };
            const usageUpdate = event.message?.usage ?? event.usage;
            if (usageUpdate !== undefined) {
              usage = mergeAnthropicTokenUsage(usage, usageUpdate);
              actualTokens = usage.totalTokens;
              yield { usage };
            }
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
    } catch (error) {
      failure = responseLease.normalizeFailure(error);
      throw failure;
    } finally {
      await finalizeProviderStream(responseLease, reader, completed, actualTokens, failure);
    }
  }

  public async generateTurn(
    messages: ReadonlyArray<AgentMessage>,
    tools: ReadonlyArray<ToolDefinition>,
    options: GenerateOptions,
  ): Promise<ModelTurnResponse> {
    const startTime = Date.now();
    const { url, headers, body } = this.buildPayload(messages, tools, options, false);
    const responseLease = await executeProviderRequest({
      providerId: "anthropic",
      url,
      headers,
      body,
      timeoutMs: this.config.timeoutMs ?? 60_000,
      maxRetries: this.config.maxRetries ?? 2,
      responseMode: "buffered",
      callerSignal: options.signal,
      permitSource: this.config.permitSource,
      parseError: parseAnthropicResponseError,
    });
    const duration = Date.now() - startTime;

    return await consumeProviderTurnResponse(responseLease, async (response) => {
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

      const usage = mergeAnthropicTokenUsage(createEmptyTokenUsage(), payload.usage);

      return {
        text: fullText,
        toolCalls,
        finishReason: mapFinishReason(payload.stop_reason),
        usage,
        timeToFirstTokenMs: duration,
        totalTurnDurationMs: duration,
      };
    });
  }
}

function createEmptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
  };
}

function mergeAnthropicTokenUsage(
  current: TokenUsage,
  update: AnthropicResponsePayload["usage"],
): TokenUsage {
  const inputTokens = update?.input_tokens ?? current.inputTokens;
  const outputTokens = update?.output_tokens ?? current.outputTokens;
  const cacheCreationInputTokens =
    update?.cache_creation_input_tokens ?? current.cacheCreationInputTokens;
  const cacheReadInputTokens = update?.cache_read_input_tokens ?? current.cacheReadInputTokens;
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
  };
}

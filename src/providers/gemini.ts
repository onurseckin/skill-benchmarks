import { calculateTokenCostUSD } from "./pricing";
import { executeProviderRequest } from "./transport/request-executor.js";
import {
  consumeProviderTurnResponse,
  finalizeProviderStream,
  readProviderStreamChunk,
} from "./transport/response-lifecycle.js";
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

interface GeminiPart {
  readonly text?: string;
  readonly inlineData?: { readonly mimeType: string; readonly data: string };
  readonly functionCall?: {
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
  };
  readonly functionResponse?: {
    readonly name: string;
    readonly response: Readonly<Record<string, unknown>>;
  };
}

function parseGeminiResponseError(response: Response, rawText: string): ProviderError {
  let errorMessage = `Gemini API error ${response.status}`;
  try {
    const parsed = JSON.parse(rawText) as { readonly error?: { readonly message?: string } };
    if (parsed.error?.message !== undefined) errorMessage = parsed.error.message;
  } catch {
    if (rawText.length > 0) errorMessage = rawText;
  }
  return parseGeminiError(response.status, errorMessage, rawText);
}

interface GeminiContent {
  readonly role: "user" | "model";
  readonly parts: readonly GeminiPart[];
}

interface GeminiCandidate {
  readonly content?: { readonly parts?: readonly GeminiPart[]; readonly role?: string };
  readonly finishReason?: string;
}

interface GeminiUsageMetadata {
  readonly promptTokenCount?: number;
  readonly candidatesTokenCount?: number;
  readonly cachedContentTokenCount?: number;
  readonly totalTokenCount?: number;
}

interface GeminiResponsePayload {
  readonly candidates?: readonly GeminiCandidate[];
  readonly usageMetadata?: GeminiUsageMetadata;
  readonly error?: { readonly code?: number; readonly message?: string; readonly status?: string };
}

function mapGeminiFinishReason(reason: string | undefined): FinishReason {
  if (reason === "STOP") return "stop";
  if (reason === "MAX_TOKENS") return "length";
  if (reason === "SAFETY" || reason === "RECITATION") return "content_filter";
  return "stop";
}

function parseGeminiError(status: number, message: string, raw: unknown): ProviderError {
  if (status === 401 || status === 403 || message.includes("API key not valid")) {
    return new ProviderAuthenticationError(message, "google", {
      statusCode: status,
      rawError: raw,
    });
  }
  if (status === 429 || message.includes("RESOURCE_EXHAUSTED")) {
    return new ProviderRateLimitError(message, "google", { statusCode: status, rawError: raw });
  }
  if (status === 400 && message.includes("context length")) {
    return new ProviderContextLengthExceededError(message, "google", {
      statusCode: status,
      rawError: raw,
    });
  }
  if (status === 408 || status === 504) {
    return new ProviderTimeoutError(message, "google", { statusCode: status, rawError: raw });
  }
  return new ProviderError(message, "google", {
    statusCode: status,
    isRetryable: status >= 500,
    rawError: raw,
  });
}

function convertPartsToGeminiParts(
  parts: readonly AgentMessageContentPart[],
): readonly GeminiPart[] {
  const geminiParts: GeminiPart[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      geminiParts.push({ text: part.text });
    } else if (part.type === "image") {
      geminiParts.push({ inlineData: { mimeType: part.mimeType, data: part.data } });
    } else if (part.type === "tool_call") {
      geminiParts.push({ functionCall: { name: part.name, args: part.arguments } });
    } else if (part.type === "tool_result") {
      let parsedOutput: Record<string, unknown>;
      try {
        parsedOutput = JSON.parse(part.output) as Record<string, unknown>;
      } catch {
        parsedOutput = { output: part.output };
      }
      geminiParts.push({ functionResponse: { name: part.toolCallId, response: parsedOutput } });
    }
  }
  return geminiParts;
}

export class GeminiProviderAdapter implements LLMProviderAdapter {
  public readonly providerId: ProviderId = "google";
  public readonly modelId: string;
  private readonly config: ProviderConfig;

  constructor(modelId?: string, config?: Partial<ProviderConfig>) {
    this.modelId = modelId !== undefined && modelId.length > 0 ? modelId : "gemini-2.0-flash";
    const envKey =
      process.env.GEMINI_API_KEY !== undefined
        ? process.env.GEMINI_API_KEY
        : process.env.GOOGLE_API_KEY;
    this.config = {
      providerId: "google",
      apiKey: config !== undefined && config.apiKey !== undefined ? config.apiKey : envKey,
      baseUrl:
        config !== undefined && config.baseUrl !== undefined
          ? config.baseUrl
          : "https://generativelanguage.googleapis.com/v1beta",
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
      this.config.baseUrl !== undefined
        ? this.config.baseUrl
        : "https://generativelanguage.googleapis.com/v1beta";
    const apiKey = this.config.apiKey !== undefined ? this.config.apiKey : "";
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    const cleanBase = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;
    const cleanModel = this.modelId.startsWith("models/") ? this.modelId.slice(7) : this.modelId;
    const separator = action.includes("?") ? "&" : "?";
    const url = `${cleanBase}/models/${cleanModel}:${action}${separator}key=${apiKey}`;

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.customHeaders !== undefined) {
      for (const [k, v] of Object.entries(this.config.customHeaders)) headers[k] = v;
    }
    if (options.customHeaders !== undefined) {
      for (const [k, v] of Object.entries(options.customHeaders)) headers[k] = v;
    }

    let systemInstruction: { readonly parts: readonly GeminiPart[] } | undefined = undefined;
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        systemInstruction = { parts: [{ text }] };
      } else if (msg.role === "user" || msg.role === "tool") {
        const parts =
          typeof msg.content === "string"
            ? [{ text: msg.content }]
            : convertPartsToGeminiParts(msg.content);
        contents.push({ role: "user", parts });
      } else if (msg.role === "assistant") {
        const parts =
          typeof msg.content === "string"
            ? [{ text: msg.content }]
            : convertPartsToGeminiParts(msg.content);
        contents.push({ role: "model", parts });
      }
    }

    const functionDeclarations = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const generationConfig: Record<string, unknown> = { temperature: options.temperature };
    if (options.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens;
    if (options.topP !== undefined) generationConfig.topP = options.topP;
    if (options.stopSequences !== undefined && options.stopSequences.length > 0) {
      generationConfig.stopSequences = options.stopSequences;
    }
    if (options.thinkingBudgetTokens !== undefined) {
      generationConfig.thinkingConfig = { thinkingBudget: options.thinkingBudgetTokens };
    }

    const bodyObj: Record<string, unknown> = { contents, generationConfig };
    if (systemInstruction !== undefined) bodyObj.systemInstruction = systemInstruction;
    if (functionDeclarations.length > 0) bodyObj.tools = [{ functionDeclarations }];

    return { url, headers, body: JSON.stringify(bodyObj) };
  }

  public async *generateStream(
    messages: ReadonlyArray<AgentMessage>,
    tools: ReadonlyArray<ToolDefinition>,
    options: GenerateOptions,
  ): AsyncIterable<CompletionChunk> {
    const { url, headers, body } = this.buildPayload(messages, tools, options, true);
    const responseLease = await executeProviderRequest({
      providerId: "google",
      url,
      headers,
      body,
      timeoutMs: this.config.timeoutMs ?? 60_000,
      maxRetries: this.config.maxRetries ?? 2,
      responseMode: "stream",
      callerSignal: options.signal,
      permitSource: this.config.permitSource,
      parseError: parseGeminiResponseError,
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
          try {
            const payload = JSON.parse(dataStr) as GeminiResponsePayload;
            if (payload.usageMetadata !== undefined) {
              const usage = createGeminiTokenUsage(payload);
              actualTokens = usage.totalTokens;
              yield { usage };
            }
            if (payload.candidates !== undefined && payload.candidates.length > 0) {
              const cand = payload.candidates[0];
              if (
                cand !== undefined &&
                cand.content !== undefined &&
                cand.content.parts !== undefined
              ) {
                for (const part of cand.content.parts) {
                  if (part.text !== undefined) yield { textDelta: part.text };
                }
              }
              if (cand !== undefined && cand.finishReason !== undefined) {
                yield { finishReason: mapGeminiFinishReason(cand.finishReason) };
              }
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
      providerId: "google",
      url,
      headers,
      body,
      timeoutMs: this.config.timeoutMs ?? 60_000,
      maxRetries: this.config.maxRetries ?? 2,
      responseMode: "buffered",
      callerSignal: options.signal,
      permitSource: this.config.permitSource,
      parseError: parseGeminiResponseError,
    });
    const duration = Date.now() - startTime;

    return await consumeProviderTurnResponse(responseLease, async (response) => {
      const payload = (await response.json()) as GeminiResponsePayload;
      let fullText = "";
      const toolCalls: ToolCallRequest[] = [];
      let finishReason: FinishReason = "stop";

      if (payload.candidates !== undefined && payload.candidates.length > 0) {
        const cand = payload.candidates[0];
        if (cand !== undefined) {
          finishReason = mapGeminiFinishReason(cand.finishReason);
          if (cand.content !== undefined && cand.content.parts !== undefined) {
            for (const [idx, part] of cand.content.parts.entries()) {
              if (part.text !== undefined) fullText += part.text;
              if (part.functionCall !== undefined) {
                toolCalls.push({
                  id: `call_${part.functionCall.name}_${idx}`,
                  name: part.functionCall.name,
                  arguments: part.functionCall.args,
                  rawArguments: JSON.stringify(part.functionCall.args),
                });
              }
            }
          }
        }
      }

      const usage = createGeminiTokenUsage(payload);

      return {
        text: fullText,
        toolCalls,
        finishReason,
        usage,
        timeToFirstTokenMs: duration,
        totalTurnDurationMs: duration,
      };
    });
  }
}

function createGeminiTokenUsage(payload: GeminiResponsePayload): TokenUsage {
  const inputTokens = payload.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = payload.usageMetadata?.candidatesTokenCount ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: payload.usageMetadata?.cachedContentTokenCount ?? 0,
    totalTokens: inputTokens + outputTokens,
  };
}

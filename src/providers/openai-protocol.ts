import type { AgentMessageContentPart, FinishReason, ProviderId } from "./types.js";
import {
  ProviderAuthenticationError,
  ProviderContextLengthExceededError,
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from "./types.js";

export interface OpenAIChatMessage {
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

export interface OpenAIChoice {
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

export interface OpenAIResponsePayload {
  readonly id?: string;
  readonly choices?: readonly OpenAIChoice[];
  readonly usage?: OpenAIUsageResponse;
  readonly error?: { readonly message?: string; readonly type?: string; readonly code?: string };
}

export function mapOpenAIFinishReason(reason: string | null | undefined): FinishReason {
  if (reason === "stop") return "stop";
  if (reason === "tool_calls") return "tool_calls";
  if (reason === "length") return "length";
  if (reason === "content_filter") return "content_filter";
  return "stop";
}

export function parseOpenAIError(
  status: number,
  message: string,
  raw: unknown,
  providerId: ProviderId,
): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderAuthenticationError(message, providerId, {
      statusCode: status,
      rawError: raw,
    });
  }
  if (status === 429) {
    return new ProviderRateLimitError(message, providerId, { statusCode: status, rawError: raw });
  }
  if (
    status === 400 &&
    (message.includes("maximum context length") || message.includes("tokens"))
  ) {
    return new ProviderContextLengthExceededError(message, providerId, {
      statusCode: status,
      rawError: raw,
    });
  }
  if (status === 408 || status === 504) {
    return new ProviderTimeoutError(message, providerId, { statusCode: status, rawError: raw });
  }
  return new ProviderError(message, providerId, {
    statusCode: status,
    isRetryable: status >= 500,
    rawError: raw,
  });
}

export function convertPartsToOpenAIContent(
  parts: readonly AgentMessageContentPart[],
): readonly unknown[] {
  const openAIParts: unknown[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      openAIParts.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      openAIParts.push({
        type: "image_url",
        image_url: { url: `data:${part.mimeType};base64,${part.data}` },
      });
    }
  }
  return openAIParts;
}

import type { AgentMessageContentPart, FinishReason } from "./types.js";
import {
  ProviderAuthenticationError,
  ProviderContextLengthExceededError,
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from "./types.js";

export interface AnthropicContentBlock {
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

export interface AnthropicWireMessage {
  readonly role: "user" | "assistant";
  readonly content: string | readonly AnthropicContentBlock[];
}

export interface AnthropicToolDeclaration {
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

export interface AnthropicResponsePayload {
  readonly id?: string;
  readonly type?: string;
  readonly role?: string;
  readonly content?: readonly AnthropicContentBlock[];
  readonly stop_reason?: string | null;
  readonly usage?: AnthropicUsageResponse;
  readonly error?: { readonly type?: string; readonly message?: string };
}

export function mapAnthropicFinishReason(stopReason: string | null | undefined): FinishReason {
  if (stopReason === "end_turn" || stopReason === "stop_sequence") return "stop";
  if (stopReason === "tool_use") return "tool_calls";
  if (stopReason === "max_tokens") return "length";
  if (stopReason === "content_filter") return "content_filter";
  return "stop";
}

export function parseAnthropicError(
  status: number,
  errorType: string,
  message: string,
  raw: unknown,
): ProviderError {
  if (status === 401 || status === 403 || errorType === "authentication_error") {
    return new ProviderAuthenticationError(message, "anthropic", {
      statusCode: status,
      rawError: raw,
    });
  }
  if (status === 429 || errorType === "rate_limit_error") {
    return new ProviderRateLimitError(message, "anthropic", { statusCode: status, rawError: raw });
  }
  if (
    status === 400 &&
    (errorType === "invalid_request_error" || message.includes("prompt is too long"))
  ) {
    return new ProviderContextLengthExceededError(message, "anthropic", {
      statusCode: status,
      rawError: raw,
    });
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

export function convertPartsToAnthropicBlocks(
  parts: readonly AgentMessageContentPart[],
): readonly AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: part.mimeType, data: part.data },
      });
    } else if (part.type === "tool_call") {
      blocks.push({ type: "tool_use", id: part.id, name: part.name, input: part.arguments });
    } else if (part.type === "tool_result") {
      blocks.push({
        type: "tool_result",
        tool_use_id: part.toolCallId,
        content: part.output,
        is_error: part.isError,
      });
    }
  }
  return blocks;
}

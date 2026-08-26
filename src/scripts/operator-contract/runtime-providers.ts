import { AnthropicProviderAdapter } from "../../providers/anthropic.js";
import { GeminiProviderAdapter } from "../../providers/gemini.js";
import { OpenAIProviderAdapter } from "../../providers/openai.js";
import {
  ProviderAuthenticationError,
  ProviderError,
  ProviderTimeoutError,
  type LLMProviderAdapter,
} from "../../providers/types.js";
import { requireCondition } from "./assertions.js";

const messages = [{ role: "user", content: "fixture" }] as const;
const options = { temperature: 0 } as const;

export async function verifyProviderRuntimeLifecycle(): Promise<void> {
  await verifyRetryableThenSuccess();
  await verifyAuthenticationDoesNotRetry();
  await verifyRetryExhaustion();
  await verifyBoundedRateLimitWait();
  await verifyProviderTimeout();
  await verifyProviderBodyTimeout();
  await verifyAllAdaptersUseInterceptedTransport();
}

async function verifyProviderBodyTimeout(): Promise<void> {
  const adapter = createOpenAIAdapter({ maxRetries: 0, timeoutMs: 15 });
  const stalledBody = new ReadableStream<Uint8Array>({ start() {} });
  const pending = withInterceptedFetch(
    async () => new Response(stalledBody, { status: 200 }),
    async () => await adapter.generateTurn(messages, [], options),
  );
  const failure = await settleFailureWithin(pending, 150);
  requireCondition(failure instanceof ProviderTimeoutError, "provider_body_timeout_type");
}

async function verifyRetryableThenSuccess(): Promise<void> {
  let attempts = 0;
  const adapter = createOpenAIAdapter({ maxRetries: 1 });
  const result = await withInterceptedFetch(async () => {
    attempts += 1;
    return attempts === 1 ? errorResponse(503) : openAISuccessResponse("retried");
  }, async () => await adapter.generateTurn(messages, [], options));
  requireCondition(attempts === 2, "provider_retry_success_attempts");
  requireCondition(result.text === "retried", "provider_retry_success_payload");
}

async function verifyAuthenticationDoesNotRetry(): Promise<void> {
  let attempts = 0;
  const adapter = createOpenAIAdapter({ maxRetries: 3 });
  const failure = await captureFailure(
    withInterceptedFetch(async () => {
      attempts += 1;
      return errorResponse(401);
    }, async () => await adapter.generateTurn(messages, [], options)),
  );
  requireCondition(failure instanceof ProviderAuthenticationError, "provider_authentication_type");
  requireCondition(attempts === 1, "provider_authentication_attempts");
}

async function verifyRetryExhaustion(): Promise<void> {
  let attempts = 0;
  const adapter = createOpenAIAdapter({ maxRetries: 2 });
  const failure = await captureFailure(
    withInterceptedFetch(async () => {
      attempts += 1;
      return errorResponse(503);
    }, async () => await adapter.generateTurn(messages, [], options)),
  );
  requireCondition(failure instanceof ProviderError, "provider_retry_exhaustion_type");
  requireCondition(attempts === 3, "provider_retry_exhaustion_attempts");
}

async function verifyBoundedRateLimitWait(): Promise<void> {
  let attempts = 0;
  const controller = new AbortController();
  const adapter = createOpenAIAdapter({ maxRetries: 2 });
  const startedAt = Date.now();
  const abortTimer = setTimeout(() => controller.abort(new Error("fixture caller abort")), 20);
  const failure = await captureFailure(
    withInterceptedFetch(async () => {
      attempts += 1;
      return errorResponse(429, { "retry-after": "3600" });
    }, async () => await adapter.generateTurn(messages, [], { ...options, signal: controller.signal })),
  );
  clearTimeout(abortTimer);
  requireCondition(failure instanceof Error && failure.name === "ExecutionAbortedError", "provider_rate_limit_abort_type");
  requireCondition(attempts === 1, "provider_rate_limit_abort_attempts");
  requireCondition(Date.now() - startedAt < 250, "provider_rate_limit_abort_bound");
}

async function verifyProviderTimeout(): Promise<void> {
  const adapter = createOpenAIAdapter({ maxRetries: 0, timeoutMs: 15 });
  const pending = withInterceptedFetch(
    async () => await new Promise<Response>(() => {}),
    async () => await adapter.generateTurn(messages, [], options),
  );
  const failure = await settleFailureWithin(pending, 150);
  requireCondition(failure instanceof ProviderTimeoutError, "provider_timeout_type");
}

async function verifyAllAdaptersUseInterceptedTransport(): Promise<void> {
  const cases: readonly {
    readonly adapter: LLMProviderAdapter;
    readonly success: Response;
  }[] = [
    {
      adapter: new AnthropicProviderAdapter("fixture", createProviderConfig("anthropic")),
      success: anthropicSuccessResponse(),
    },
    {
      adapter: new GeminiProviderAdapter("fixture", createProviderConfig("google")),
      success: geminiSuccessResponse(),
    },
  ];
  for (const providerCase of cases) {
    let attempts = 0;
    await withInterceptedFetch(async () => {
      attempts += 1;
      return attempts === 1 ? errorResponse(503) : providerCase.success;
    }, async () => await providerCase.adapter.generateTurn(messages, [], options));
    requireCondition(attempts === 2, "provider_shared_transport_attempts");
  }
}

function createOpenAIAdapter(overrides: { readonly maxRetries: number; readonly timeoutMs?: number }): OpenAIProviderAdapter {
  return new OpenAIProviderAdapter("fixture", {
    ...createProviderConfig("openai"),
    ...overrides,
  });
}

function createProviderConfig(providerId: "anthropic" | "google" | "openai") {
  return {
    providerId,
    apiKey: "fixture-key",
    baseUrl: "https://fixture.invalid",
    timeoutMs: 100,
    maxRetries: 1,
  } as const;
}

async function withInterceptedFetch<T>(
  interceptedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  execute: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = interceptedFetch as typeof fetch;
  try {
    return await execute();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function captureFailure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

async function settleFailureWithin(promise: Promise<unknown>, timeoutMs: number): Promise<unknown> {
  const timeoutMarker = Symbol("timeout");
  const settled = await Promise.race([
    captureFailure(promise),
    new Promise<typeof timeoutMarker>((resolve) => setTimeout(() => resolve(timeoutMarker), timeoutMs)),
  ]);
  return settled === timeoutMarker ? undefined : settled;
}

function errorResponse(status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json");
  return new Response(JSON.stringify({ error: { message: `fixture ${status}` } }), {
    status,
    headers: responseHeaders,
  });
}

function openAISuccessResponse(text: string): Response {
  return jsonResponse({
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
}

function anthropicSuccessResponse(): Response {
  return jsonResponse({
    content: [{ type: "text", text: "ok" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 3, output_tokens: 2 },
  });
}

function geminiSuccessResponse(): Response {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

import { AnthropicProviderAdapter } from "../../providers/anthropic.js";
import { GeminiProviderAdapter } from "../../providers/gemini.js";
import { OpenAIProviderAdapter } from "../../providers/openai.js";
import {
  ProviderAuthenticationError,
  ProviderError,
  ProviderTimeoutError,
  type LLMProviderAdapter,
} from "../../providers/types.js";
import type { ProviderTurnOutcome } from "../../shared/provider-turn-permit.js";
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
  await verifyProviderStreamTimeoutFinalization();
  await verifyAttemptPermitsAndActualUsage();
  await verifyStreamPermitActualUsage();
  await verifyNonfiniteRetryRejection();
  await verifyAllAdaptersUseInterceptedTransport();
}

interface PermitReleaseRecord {
  readonly outcome: ProviderTurnOutcome;
  readonly actualTokens?: number;
  readonly retryAfterMs?: number;
}

interface PermitRecorder {
  readonly releases: PermitReleaseRecord[];
  readonly source: {
    acquire(estimatedTokens: number, signal?: AbortSignal): Promise<{
      release(
        outcome: ProviderTurnOutcome,
        actualTokens?: number,
        retryAfterMs?: number,
      ): Promise<void>;
    }>;
  };
  readonly acquisitionCount: () => number;
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

export async function verifyProviderStreamTimeoutFinalization(): Promise<void> {
  let cancelled = false;
  const adapter = createOpenAIAdapter({ maxRetries: 0, timeoutMs: 15 });
  const stalledBody = new ReadableStream<Uint8Array>({
    start() {},
    cancel() {
      cancelled = true;
      return new Promise<void>(() => {});
    },
  });
  const pending = withInterceptedFetch(
    async () => new Response(stalledBody, { status: 200 }),
    async () => await adapter.generateStream(messages, [], options)[Symbol.asyncIterator]().next(),
  );
  const failure = await settleFailureWithin(pending, 150);
  requireCondition(failure instanceof ProviderTimeoutError, "provider_stream_timeout_type");
  requireCondition(cancelled, "provider_stream_timeout_cancelled");
}

export async function verifyAttemptPermitsAndActualUsage(): Promise<void> {
  const recorder = createPermitRecorder();
  let attempts = 0;
  const adapter = createOpenAIAdapter({ maxRetries: 1, permitSource: recorder.source });
  await withInterceptedFetch(async () => {
    attempts += 1;
    return attempts === 1 ? errorResponse(503) : openAISuccessResponse("permit-success");
  }, async () => await adapter.generateTurn(messages, [], options));
  requireCondition(recorder.acquisitionCount() === 2, "provider_permit_per_attempt");
  requireCondition(recorder.releases.length === 2, "provider_permit_release_count");
  requireCondition(recorder.releases[0]?.outcome === "failed", "provider_permit_retry_outcome");
  requireCondition(
    recorder.releases[1]?.outcome === "completed" &&
      recorder.releases[1]?.actualTokens === 5,
    "provider_permit_actual_usage",
  );
}

export async function verifyStreamPermitActualUsage(): Promise<void> {
  const recorder = createPermitRecorder();
  const adapter = createOpenAIAdapter({ maxRetries: 0, permitSource: recorder.source });
  const encoded = new TextEncoder().encode(
    `data: ${JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    })}\n\ndata: [DONE]\n\n`,
  );
  await withInterceptedFetch(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoded);
            controller.close();
          },
        }),
        { status: 200 },
      ),
    async () => {
      for await (const _chunk of adapter.generateStream(messages, [], options)) {
        void _chunk;
      }
    },
  );
  requireCondition(recorder.acquisitionCount() === 1, "provider_stream_permit_acquired");
  requireCondition(
    recorder.releases[0]?.outcome === "completed" &&
      recorder.releases[0]?.actualTokens === 5,
    "provider_stream_permit_actual_usage",
  );
}

export async function verifyNonfiniteRetryRejection(): Promise<void> {
  for (const maxRetries of [Number.NaN, Number.POSITIVE_INFINITY]) {
    let attempts = 0;
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(new Error("fixture retry guard")), 20);
    const adapter = createOpenAIAdapter({ maxRetries });
    const failure = await settleFailureWithin(
      withInterceptedFetch(async () => {
        attempts += 1;
        return errorResponse(503);
      }, async () => await adapter.generateTurn(messages, [], { ...options, signal: controller.signal })),
      150,
    );
    clearTimeout(abortTimer);
    requireCondition(failure instanceof TypeError, "provider_nonfinite_retry_type");
    requireCondition(attempts === 0, "provider_nonfinite_retry_attempts");
  }
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
  const recorder = createPermitRecorder();
  const controller = new AbortController();
  const adapter = createOpenAIAdapter({ maxRetries: 2, permitSource: recorder.source });
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
  requireCondition(
    recorder.releases[0]?.outcome === "rate_limited" &&
      recorder.releases[0]?.retryAfterMs === 3_600_000,
    "provider_rate_limit_permit_outcome",
  );
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

function createOpenAIAdapter(
  overrides: {
    readonly maxRetries: number;
    readonly timeoutMs?: number;
    readonly permitSource?: PermitRecorder["source"];
  },
): OpenAIProviderAdapter {
  return new OpenAIProviderAdapter("fixture", {
    ...createProviderConfig("openai"),
    ...overrides,
  });
}

function createPermitRecorder(): PermitRecorder {
  let acquisitionCount = 0;
  const releases: PermitReleaseRecord[] = [];
  return {
    releases,
    acquisitionCount: () => acquisitionCount,
    source: {
      async acquire() {
        acquisitionCount += 1;
        let releasePromise: Promise<void> | undefined;
        return {
          release(outcome, actualTokens, retryAfterMs) {
            releasePromise ??= Promise.resolve().then(() => {
              releases.push({ outcome, actualTokens, retryAfterMs });
            });
            return releasePromise;
          },
        };
      },
    },
  };
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

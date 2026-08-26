import {
  createCancellationScope,
  ExecutionAbortedError,
  ExecutionTimeoutError,
  raceWithCancellation,
  resolveAbortReason,
  waitForRetry,
} from "../../shared/cancellation.js";
import {
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from "../types.js";
import {
  parseRetryAfterMs,
  resolveProviderRetryDelayMs,
  shouldRetryProviderFailure,
} from "./retry-policy.js";
import type { ProviderRequestInput } from "./types.js";

export async function executeProviderRequest(input: ProviderRequestInput): Promise<Response> {
  const maxRetries = Math.max(0, Math.floor(input.maxRetries));
  for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
    throwIfCallerAborted(input.callerSignal);
    const attemptScope = createCancellationScope({
      scope: "provider",
      callerSignal: input.callerSignal,
      timeoutMs: input.timeoutMs,
    });
    let failure: ProviderError | ExecutionAbortedError | ExecutionTimeoutError | undefined;
    try {
      const request = fetch(input.url, {
        method: "POST",
        headers: input.headers,
        body: input.body,
        signal: attemptScope.signal,
      });
      const response = await raceWithCancellation(request, attemptScope.signal, "provider");
      attemptScope.throwIfAborted();
      if (response.ok) {
        if (input.responseMode === "stream") return response;
        return await bufferResponse(response, attemptScope.signal);
      }
      const rawText = await readResponseText(response, attemptScope.signal);
      const parsed = input.parseError(response, rawText);
      const retryAfterMs = parseRetryAfterMs(response.headers);
      failure = attachRetryAfter(parsed, retryAfterMs);
    } catch (error) {
      failure = classifyAttemptFailure(error, input, attemptScope.signal);
    } finally {
      attemptScope.dispose();
    }
    throwIfCallerAborted(input.callerSignal);
    if (failure instanceof ExecutionAbortedError) throw failure;
    if (failure instanceof ExecutionTimeoutError && failure.scope !== "provider") throw failure;
    const providerFailure =
      failure instanceof ExecutionTimeoutError
        ? new ProviderTimeoutError(
            `Provider request timed out after ${input.timeoutMs}ms`,
            input.providerId,
            { timeoutMs: input.timeoutMs, cause: failure },
          )
        : failure;
    if (!shouldRetryProviderFailure(providerFailure, attemptIndex, maxRetries)) {
      throw providerFailure;
    }
    await waitForRetry(resolveProviderRetryDelayMs(providerFailure, attemptIndex), input.callerSignal);
  }
  throw new ProviderError("Provider request exhausted retries", input.providerId);
}

async function bufferResponse(response: Response, signal: AbortSignal): Promise<Response> {
  const body = await raceWithCancellation(response.arrayBuffer(), signal, "provider");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function readResponseText(response: Response, signal: AbortSignal): Promise<string> {
  try {
    return await raceWithCancellation(response.text(), signal, "provider");
  } catch (error) {
    if (signal.aborted) throw error;
    return "";
  }
}

function throwIfCallerAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw resolveAbortReason(signal, "provider");
}

function classifyAttemptFailure(
  error: unknown,
  input: ProviderRequestInput,
  attemptSignal: AbortSignal,
): ProviderError | ExecutionAbortedError | ExecutionTimeoutError {
  if (input.callerSignal?.aborted === true) {
    return resolveAbortReason(input.callerSignal, "provider") as
      | ExecutionAbortedError
      | ExecutionTimeoutError;
  }
  if (attemptSignal.aborted) {
    return resolveAbortReason(attemptSignal, "provider") as
      | ExecutionAbortedError
      | ExecutionTimeoutError;
  }
  if (
    error instanceof ProviderError ||
    error instanceof ExecutionAbortedError ||
    error instanceof ExecutionTimeoutError
  ) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError(`Provider network failure: ${message}`, input.providerId, {
    isRetryable: true,
    cause: error,
  });
}

function attachRetryAfter(error: ProviderError, retryAfterMs: number | undefined): ProviderError {
  if (!(error instanceof ProviderRateLimitError) || retryAfterMs === undefined) return error;
  return new ProviderRateLimitError(error.message, error.providerId, {
    statusCode: error.statusCode,
    retryAfterMs,
    cause: error.cause,
    rawError: error.rawError,
  });
}

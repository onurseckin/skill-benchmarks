import {
  createCancellationScope,
  ExecutionAbortedError,
  ExecutionTimeoutError,
  raceWithCancellation,
  resolveAbortReason,
  waitForRetry,
  type CancellationScope,
} from "../../shared/cancellation.js";
import type { ProviderTurnOutcome, ProviderTurnPermit } from "../../shared/provider-turn-permit.js";
import { ProviderError, ProviderRateLimitError, ProviderTimeoutError } from "../types.js";
import {
  parseRetryAfterMs,
  resolveProviderRetryDelayMs,
  shouldRetryProviderFailure,
} from "./retry-policy.js";
import type { ProviderRequestInput, ProviderResponseLease } from "./types.js";

type AttemptFailure = ProviderError | ExecutionAbortedError | ExecutionTimeoutError;

export async function executeProviderRequest(
  input: ProviderRequestInput,
): Promise<ProviderResponseLease> {
  const maxRetries = normalizeMaxRetries(input.maxRetries);
  for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
    throwIfCallerAborted(input.callerSignal);
    const permit = await input.permitSource?.acquire(
      input.estimatedTokens ?? 2_000,
      input.callerSignal,
    );
    const attemptScope = createCancellationScope({
      scope: "provider",
      callerSignal: input.callerSignal,
      timeoutMs: input.timeoutMs,
    });
    let failure: AttemptFailure;
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
        const ownedResponse =
          input.responseMode === "stream"
            ? response
            : await bufferResponse(response, attemptScope.signal);
        attemptScope.throwIfAborted();
        return createProviderResponseLease(input, ownedResponse, attemptScope, permit);
      }
      const rawText = await readResponseText(response, attemptScope.signal);
      failure = attachRetryAfter(
        input.parseError(response, rawText),
        parseRetryAfterMs(response.headers),
      );
    } catch (error) {
      failure = classifyAttemptFailure(error, input, attemptScope.signal);
    }
    if (input.callerSignal?.aborted === true) {
      failure = resolveAbortReason(input.callerSignal, "provider") as AttemptFailure;
    }
    const surfacedFailure = surfaceProviderFailure(failure, input);
    try {
      await releaseFailedAttempt(permit, surfacedFailure);
    } finally {
      attemptScope.dispose();
    }
    if (!(surfacedFailure instanceof ProviderError)) throw surfacedFailure;
    if (!shouldRetryProviderFailure(surfacedFailure, attemptIndex, maxRetries)) {
      throw surfacedFailure;
    }
    await waitForRetry(
      resolveProviderRetryDelayMs(surfacedFailure, attemptIndex),
      input.callerSignal,
    );
  }
  throw new ProviderError("Provider request exhausted retries", input.providerId);
}

function createProviderResponseLease(
  input: ProviderRequestInput,
  response: Response,
  scope: CancellationScope,
  permit: ProviderTurnPermit | undefined,
): ProviderResponseLease {
  let finalization: Promise<void> | undefined;
  const normalizeFailure = (error: unknown): AttemptFailure =>
    surfaceProviderFailure(classifyAttemptFailure(error, input, scope.signal), input);
  const finalize = (
    outcome: ProviderTurnOutcome,
    actualTokens?: number,
    retryAfterMs?: number,
  ): Promise<void> => {
    if (finalization === undefined) {
      scope.dispose();
      finalization = permit?.release(outcome, actualTokens, retryAfterMs) ?? Promise.resolve();
    }
    return finalization;
  };
  return {
    response,
    signal: scope.signal,
    async read<T>(operation: Promise<T>): Promise<T> {
      try {
        const value = await raceWithCancellation(operation, scope.signal, "provider");
        scope.throwIfAborted();
        return value;
      } catch (error) {
        throw normalizeFailure(error);
      }
    },
    normalizeFailure,
    complete: async (actualTokens) => await finalize("completed", actualTokens),
    async fail(error): Promise<Error> {
      const failure = normalizeFailure(error);
      await finalize(
        resolveFailureOutcome(failure),
        undefined,
        failure instanceof ProviderRateLimitError ? failure.retryAfterMs : undefined,
      );
      return failure;
    },
    abort: async () => await finalize("aborted"),
    finalize,
  };
}

async function releaseFailedAttempt(
  permit: ProviderTurnPermit | undefined,
  failure: AttemptFailure,
): Promise<void> {
  if (permit === undefined) return;
  await permit.release(
    resolveFailureOutcome(failure),
    undefined,
    failure instanceof ProviderRateLimitError ? failure.retryAfterMs : undefined,
  );
}

function resolveFailureOutcome(error: AttemptFailure): ProviderTurnOutcome {
  if (error instanceof ProviderRateLimitError) return "rate_limited";
  if (
    error instanceof ExecutionAbortedError ||
    (error instanceof ExecutionTimeoutError && error.scope !== "provider")
  ) {
    return "aborted";
  }
  return "failed";
}

function surfaceProviderFailure(
  failure: AttemptFailure,
  input: ProviderRequestInput,
): AttemptFailure {
  if (failure instanceof ExecutionTimeoutError && failure.scope === "provider") {
    return new ProviderTimeoutError(
      `Provider request timed out after ${input.timeoutMs}ms`,
      input.providerId,
      { timeoutMs: input.timeoutMs, cause: failure },
    );
  }
  return failure;
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
): AttemptFailure {
  if (input.callerSignal?.aborted === true) {
    return resolveAbortReason(input.callerSignal, "provider") as AttemptFailure;
  }
  if (attemptSignal.aborted) {
    return resolveAbortReason(attemptSignal, "provider") as AttemptFailure;
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

function normalizeMaxRetries(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError("Provider maxRetries must be finite");
  return Math.max(0, Math.floor(value));
}

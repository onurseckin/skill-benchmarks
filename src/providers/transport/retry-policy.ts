import { ProviderRateLimitError, type ProviderError } from "../types.js";

export const MAX_PROVIDER_RETRY_DELAY_MS = 30_000;
const BASE_PROVIDER_RETRY_DELAY_MS = 100;

export function shouldRetryProviderFailure(error: ProviderError, attemptIndex: number, maxRetries: number): boolean {
  return error.isRetryable && attemptIndex < maxRetries;
}

export function resolveProviderRetryDelayMs(
  error: ProviderError,
  attemptIndex: number,
): number {
  const exponentialDelay = Math.min(
    MAX_PROVIDER_RETRY_DELAY_MS,
    BASE_PROVIDER_RETRY_DELAY_MS * 2 ** attemptIndex,
  );
  if (!(error instanceof ProviderRateLimitError) || error.retryAfterMs === undefined) {
    return exponentialDelay;
  }
  return Math.min(MAX_PROVIDER_RETRY_DELAY_MS, Math.max(0, error.retryAfterMs));
}

export function parseRetryAfterMs(headers: Headers, nowMs: number = Date.now()): number | undefined {
  const value = headers.get("retry-after")?.trim();
  if (value === undefined || value.length === 0) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return undefined;
  return Math.max(0, dateMs - nowMs);
}

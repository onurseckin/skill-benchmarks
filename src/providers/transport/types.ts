import type { ProviderError, ProviderId } from "../types.js";

export interface ProviderRequestInput {
  readonly providerId: ProviderId;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly responseMode: "buffered" | "stream";
  readonly callerSignal?: AbortSignal;
  readonly parseError: (response: Response, rawText: string) => ProviderError;
}

export interface ProviderAttemptFailure {
  readonly error: ProviderError;
  readonly retryAfterMs?: number;
}

import type { ProviderError, ProviderId } from "../types.js";
import type {
  ProviderTurnOutcome,
  ProviderTurnPermitSource,
} from "../../shared/provider-turn-permit.js";

export interface ProviderRequestInput {
  readonly providerId: ProviderId;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly responseMode: "buffered" | "stream";
  readonly callerSignal?: AbortSignal;
  readonly permitSource?: ProviderTurnPermitSource;
  readonly estimatedTokens?: number;
  readonly parseError: (response: Response, rawText: string) => ProviderError;
}

export interface ProviderResponseLease {
  readonly response: Response;
  readonly signal: AbortSignal;
  read<T>(operation: Promise<T>): Promise<T>;
  normalizeFailure(error: unknown): Error;
  complete(actualTokens?: number): Promise<void>;
  fail(error: unknown): Promise<Error>;
  abort(): Promise<void>;
  finalize(
    outcome: ProviderTurnOutcome,
    actualTokens?: number,
    retryAfterMs?: number,
  ): Promise<void>;
}

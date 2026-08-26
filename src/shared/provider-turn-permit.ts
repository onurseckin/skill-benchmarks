export type ProviderTurnOutcome = "completed" | "rate_limited" | "failed" | "aborted";

export interface ProviderTurnPermit {
  release(
    outcome: ProviderTurnOutcome,
    actualTokens?: number,
    retryAfterMs?: number,
  ): Promise<void>;
}

export interface ProviderTurnPermitSource {
  acquire(estimatedTokens: number, signal?: AbortSignal): Promise<ProviderTurnPermit>;
}

export type ProviderTurnPermitFinalizer = (
  outcome: ProviderTurnOutcome,
  actualTokens: number | undefined,
  retryAfterMs: number | undefined,
) => Promise<void> | void;

export function createProviderTurnPermit(
  finalize: ProviderTurnPermitFinalizer,
): ProviderTurnPermit {
  let releasePromise: Promise<void> | undefined;
  return {
    release(outcome, actualTokens, retryAfterMs): Promise<void> {
      releasePromise ??= Promise.resolve().then(async () => {
        await finalize(outcome, actualTokens, retryAfterMs);
      });
      return releasePromise;
    },
  };
}

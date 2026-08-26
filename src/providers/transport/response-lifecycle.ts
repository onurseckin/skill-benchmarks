import type { ModelTurnResponse } from "../types.js";
import type { ProviderResponseLease } from "./types.js";

export async function consumeProviderTurnResponse(
  lease: ProviderResponseLease,
  consume: (response: Response) => Promise<ModelTurnResponse>,
): Promise<ModelTurnResponse> {
  try {
    const result = await consume(lease.response);
    await lease.complete(result.usage.totalTokens);
    return result;
  } catch (error) {
    throw await lease.fail(error);
  }
}

export async function readProviderStreamChunk(
  lease: ProviderResponseLease,
  reader: ReadableStreamDefaultReader<Uint8Array>,
) {
  return await lease.read(reader.read());
}

export async function finalizeProviderStream(
  lease: ProviderResponseLease,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  completed: boolean,
  actualTokens: number | undefined,
  failure: Error | undefined,
): Promise<void> {
  let cleanupFailure = await cancelProviderReader(reader);
  try {
    reader.releaseLock();
  } catch (error) {
    cleanupFailure = error instanceof Error ? error : new Error(String(error));
  }
  const terminalFailure = failure ?? cleanupFailure;
  if (terminalFailure !== undefined) {
    await lease.fail(terminalFailure);
  } else if (completed) {
    await lease.complete(actualTokens);
  } else {
    await lease.abort();
  }
}

async function cancelProviderReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Error | undefined> {
  let failure: Error | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancellation = Promise.resolve(reader.cancel()).then(
    () => undefined,
    (error: unknown) => {
      failure = error instanceof Error ? error : new Error(String(error));
    },
  );
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, 100);
  });
  try {
    await Promise.race([cancellation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return failure;
}

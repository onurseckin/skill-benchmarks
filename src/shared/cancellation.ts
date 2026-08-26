export type ExecutionScope =
  | "scenario"
  | "turn"
  | "provider"
  | "tool"
  | "rate_limit"
  | "sweep";

export class ExecutionAbortedError extends Error {
  public readonly scope: ExecutionScope;

  constructor(scope: ExecutionScope, message = "Execution aborted", cause?: unknown) {
    super(message, { cause });
    this.name = "ExecutionAbortedError";
    this.scope = scope;
  }
}

export class ExecutionTimeoutError extends Error {
  public readonly scope: ExecutionScope;
  public readonly timeoutMs: number;
  public readonly deadlineAtMs: number;

  constructor(scope: ExecutionScope, timeoutMs: number, deadlineAtMs: number) {
    super(`${scope} execution timed out after ${timeoutMs}ms`);
    this.name = "ExecutionTimeoutError";
    this.scope = scope;
    this.timeoutMs = timeoutMs;
    this.deadlineAtMs = deadlineAtMs;
  }
}

export interface CancellationScope {
  readonly signal: AbortSignal;
  readonly deadlineAtMs?: number;
  throwIfAborted(): void;
  dispose(): void;
}

export interface CancellationScopeOptions {
  readonly scope: ExecutionScope;
  readonly callerSignal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly deadlineAtMs?: number;
}

export function createCancellationScope(options: CancellationScopeOptions): CancellationScope {
  const controller = new AbortController();
  const startedAtMs = Date.now();
  const deadlineAtMs = resolveDeadline(startedAtMs, options.timeoutMs, options.deadlineAtMs);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const abortFromCaller = (): void => {
    if (controller.signal.aborted) return;
    controller.abort(resolveAbortReason(options.callerSignal, options.scope));
  };

  if (options.callerSignal?.aborted === true) {
    abortFromCaller();
  } else if (options.callerSignal !== undefined) {
    options.callerSignal.addEventListener("abort", abortFromCaller, { once: true });
  }

  if (!controller.signal.aborted && deadlineAtMs !== undefined) {
    const timeoutMs = Math.max(0, deadlineAtMs - startedAtMs);
    const abortForTimeout = (): void => {
      if (options.callerSignal?.aborted === true) {
        abortFromCaller();
        return;
      }
      if (!controller.signal.aborted) {
        controller.abort(new ExecutionTimeoutError(options.scope, timeoutMs, deadlineAtMs));
      }
    };
    if (timeoutMs === 0) abortForTimeout();
    else timer = setTimeout(abortForTimeout, timeoutMs);
  }

  return {
    signal: controller.signal,
    deadlineAtMs,
    throwIfAborted(): void {
      if (options.callerSignal?.aborted === true) {
        throw resolveAbortReason(options.callerSignal, options.scope);
      }
      if (controller.signal.aborted) {
        throw resolveAbortReason(controller.signal, options.scope);
      }
    },
    dispose(): void {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      options.callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

export function resolveAbortReason(signal: AbortSignal | undefined, scope: ExecutionScope): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof ExecutionAbortedError || reason instanceof ExecutionTimeoutError) {
    return reason;
  }
  if (reason instanceof Error) {
    return new ExecutionAbortedError(scope, reason.message, reason);
  }
  return new ExecutionAbortedError(scope);
}

export async function raceWithCancellation<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  scope: ExecutionScope,
): Promise<T> {
  if (signal.aborted) throw resolveAbortReason(signal, scope);
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = (): void => settle(() => reject(resolveAbortReason(signal, scope)));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

export async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) throw resolveAbortReason(signal, "provider");
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = (): void =>
      settle(() => reject(resolveAbortReason(signal, "provider")));
    const timer = setTimeout(() => settle(resolve), Math.max(0, delayMs));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function resolveDeadline(
  startedAtMs: number,
  timeoutMs: number | undefined,
  deadlineAtMs: number | undefined,
): number | undefined {
  const timeoutDeadline =
    timeoutMs === undefined ? undefined : startedAtMs + Math.max(0, timeoutMs);
  if (timeoutDeadline === undefined) return deadlineAtMs;
  if (deadlineAtMs === undefined) return timeoutDeadline;
  return Math.min(timeoutDeadline, deadlineAtMs);
}

export class FixturePhaseTimeoutError extends Error {
  public constructor(phase: string) {
    super(`Fixture phase '${phase}' did not start before its deterministic deadline`);
    this.name = "FixturePhaseTimeoutError";
  }
}

export class FixturePhaseDeadline {
  public readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(timeoutMs: number) {
    this.signal = this.controller.signal;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.controller.abort();
      },
      Math.max(0, timeoutMs),
    );
  }

  public get active(): boolean {
    return this.timer !== undefined;
  }

  public dispose(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export function waitForFixturePhase(
  phase: string,
  operation: Promise<void>,
  deadlineSignal: AbortSignal | undefined,
  onListenerAdded: () => void,
  onListenerRemoved: () => void,
): Promise<void> {
  if (deadlineSignal === undefined) return operation;
  if (deadlineSignal.aborted) return Promise.reject(new FixturePhaseTimeoutError(phase));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      deadlineSignal.removeEventListener("abort", rejectForDeadline);
      onListenerRemoved();
      action();
    };
    const rejectForDeadline = (): void => finish(() => reject(new FixturePhaseTimeoutError(phase)));
    onListenerAdded();
    deadlineSignal.addEventListener("abort", rejectForDeadline, { once: true });
    void operation.then(
      () => finish(resolve),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

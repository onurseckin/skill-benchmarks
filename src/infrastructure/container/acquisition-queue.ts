import { resolveAbortReason } from "../../shared/cancellation.js";
import { QueueTimeoutError } from "./pool-errors.js";
import type { ContainerLaunchConfig, ContainerQueueTimer, IContainerInstance } from "./types.js";

interface QueueEntry {
  readonly config: ContainerLaunchConfig;
  readonly signal?: AbortSignal;
  readonly resolve: (instance: IContainerInstance) => void;
  readonly reject: (error: Error) => void;
  readonly settle: (error: Error) => void;
  readonly admit: () => ContainerAcquisitionRequest | undefined;
}

export interface ContainerAcquisitionRequest {
  readonly config: ContainerLaunchConfig;
  readonly signal?: AbortSignal;
  resolve(instance: IContainerInstance): void;
  reject(error: Error): void;
}

export class ContainerAcquisitionQueue {
  private readonly entries: QueueEntry[] = [];

  public constructor(
    private readonly queueTimeoutMs: number,
    private readonly timer: ContainerQueueTimer,
  ) {}

  public get count(): number {
    return this.entries.length;
  }

  public enqueue(config: ContainerLaunchConfig, signal?: AbortSignal): Promise<IContainerInstance> {
    if (signal?.aborted === true) {
      return Promise.reject(resolveAbortReason(signal, "sweep"));
    }
    return new Promise<IContainerInstance>((resolve, reject) => {
      let terminal = false;
      let timeoutHandle: unknown;
      const abort = (): void => {
        settle(resolveAbortReason(signal, "sweep"));
      };
      const remove = (): void => {
        const index = this.entries.indexOf(entry);
        if (index !== -1) this.entries.splice(index, 1);
      };
      const clearWaitingResources = (): void => {
        this.timer.cancel(timeoutHandle);
        signal?.removeEventListener("abort", abort);
      };
      const settle = (error: Error): void => {
        if (terminal) return;
        terminal = true;
        clearWaitingResources();
        remove();
        reject(error);
      };
      const entry: QueueEntry = {
        config,
        signal,
        resolve,
        reject,
        settle,
        admit: (): ContainerAcquisitionRequest | undefined => {
          if (terminal) return undefined;
          terminal = true;
          clearWaitingResources();
          remove();
          return {
            config,
            signal,
            resolve,
            reject,
          };
        },
      };
      timeoutHandle = this.timer.schedule(
        () => settle(new QueueTimeoutError(this.queueTimeoutMs)),
        this.queueTimeoutMs,
      );
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted === true) {
        abort();
        return;
      }
      this.entries.push(entry);
    });
  }

  public takeNext(): ContainerAcquisitionRequest | undefined {
    while (this.entries.length > 0) {
      const entry = this.entries[0];
      if (entry === undefined) return undefined;
      const request = entry.admit();
      if (request !== undefined) return request;
    }
    return undefined;
  }

  public rejectAll(error: Error): void {
    while (this.entries.length > 0) this.entries[0]?.settle(error);
  }
}

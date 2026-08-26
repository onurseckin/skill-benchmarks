import * as os from "node:os";
import { resolveAbortReason } from "../../shared/cancellation.js";
import { ContainerAcquisitionQueue } from "./acquisition-queue.js";
import { ContainerCreationLease } from "./creation-lease.js";
import { DockerClient } from "./docker-client.js";
import {
  ContainerDrainError,
  DrainInitiatedError,
  UnknownContainerLeaseError,
} from "./pool-errors.js";
import type {
  ContainerLaunchConfig,
  ContainerPoolStatus,
  ContainerQueueTimer,
  IContainerInstance,
  IContainerPoolManager,
  IDockerClient,
  PoolConfig,
} from "./types.js";

export { DrainInitiatedError, QueueTimeoutError } from "./pool-errors.js";

interface ActiveContainerRecord {
  readonly instance: IContainerInstance;
  releasePromise: Promise<void> | undefined;
  cleanupFailed: boolean;
}

const defaultQueueTimer: ContainerQueueTimer = {
  schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    return setTimeout(callback, delayMs);
  },
  cancel(handle: unknown): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export class ContainerPoolManager implements IContainerPoolManager {
  private readonly maxPoolConcurrency: number;
  private readonly startupJitterMs: number;
  private readonly dockerClient: IDockerClient;
  private readonly queue: ContainerAcquisitionQueue;
  private readonly waitForStartupJitter: (delayMs: number, signal: AbortSignal) => Promise<void>;
  private readonly activeInstances = new Map<string, ActiveContainerRecord>();
  private readonly creatingLeases = new Map<string, ContainerCreationLease>();
  private readonly failedCreationLeases = new Map<string, ContainerCreationLease>();
  private readonly retiredInstances = new WeakSet<IContainerInstance>();
  private isDraining = false;
  private drainPromise: Promise<void> | undefined;
  private nextLeaseNumber = 0;
  private lastCreationTimestamp = 0;
  private startupLock: Promise<void> = Promise.resolve();

  public constructor(config?: PoolConfig) {
    this.maxPoolConcurrency =
      config?.maxConcurrency ?? ContainerPoolManager.calculateMaxConcurrency();
    this.startupJitterMs = config?.startupJitterMs ?? 150;
    this.dockerClient = config?.dockerClient ?? new DockerClient();
    this.queue = new ContainerAcquisitionQueue(
      config?.queueTimeoutMs ?? 300000,
      config?.queueTimer ?? defaultQueueTimer,
    );
    this.waitForStartupJitter = config?.waitForStartupJitter ?? waitForAbortableDelay;
  }

  public get activeCount(): number {
    return this.activeInstances.size;
  }

  public get queuedCount(): number {
    return this.queue.count;
  }

  public get maxConcurrency(): number {
    return this.maxPoolConcurrency;
  }

  public getStatus(): ContainerPoolStatus {
    let releasingCount = 0;
    let cleanupFailedCount = this.failedCreationLeases.size;
    for (const record of this.activeInstances.values()) {
      if (record.releasePromise !== undefined) releasingCount += 1;
      if (record.cleanupFailed) cleanupFailedCount += 1;
    }
    return {
      accepting: !this.isDraining,
      queuedCount: this.queue.count,
      creatingCount: this.creatingLeases.size,
      activeCount: this.activeInstances.size,
      releasingCount,
      cleanupFailedCount,
    };
  }

  public static calculateMaxConcurrency(hostCpus?: number, totalMemoryBytes?: number): number {
    const cpus = hostCpus ?? (typeof os.cpus === "function" ? os.cpus().length : 4);
    const memoryBytes =
      totalMemoryBytes ??
      (typeof os.totalmem === "function" ? os.totalmem() : 16 * 1024 * 1024 * 1024);
    const memorySlots = Math.floor(Math.max(0, memoryBytes / 1024 ** 3 - 4) / 2.5);
    return Math.max(1, Math.min(cpus - 1, memorySlots));
  }

  public async acquire(
    config: ContainerLaunchConfig,
    signal?: AbortSignal,
  ): Promise<IContainerInstance> {
    if (this.isDraining) throw new DrainInitiatedError();
    if (signal?.aborted === true) throw resolveAbortReason(signal, "sweep");
    if (this.hasCapacity()) return this.startCreation(config, signal);
    return this.queue.enqueue(config, signal);
  }

  public release(instance: IContainerInstance): Promise<void> {
    const record = this.activeInstances.get(instance.containerId);
    if (record === undefined) {
      if (this.retiredInstances.has(instance)) return Promise.resolve();
      return Promise.reject(new UnknownContainerLeaseError(instance.containerId));
    }
    if (record.instance !== instance) {
      return Promise.reject(new UnknownContainerLeaseError(instance.containerId));
    }
    return this.releaseRecord(instance.containerId, record);
  }

  public drain(): Promise<void> {
    if (this.drainPromise !== undefined) return this.drainPromise;
    this.isDraining = true;
    const drainReason = new DrainInitiatedError();
    this.queue.rejectAll(drainReason);
    this.drainPromise = this.completeDrain(drainReason);
    void this.drainPromise.then(
      () => {
        this.drainPromise = undefined;
      },
      () => {
        this.drainPromise = undefined;
      },
    );
    return this.drainPromise;
  }

  private hasCapacity(): boolean {
    return (
      this.activeInstances.size + this.creatingLeases.size + this.failedCreationLeases.size <
      this.maxPoolConcurrency
    );
  }

  private startCreation(
    config: ContainerLaunchConfig,
    signal?: AbortSignal,
  ): Promise<IContainerInstance> {
    const lease = new ContainerCreationLease({
      id: `${config.runId}-${this.nextLeaseNumber++}`,
      config,
      dockerClient: this.dockerClient,
      signal,
      waitForStartupJitter: async (leaseSignal) => await this.enforceStartupJitter(leaseSignal),
      publish: (instance) => this.publishInstance(instance),
    });
    this.creatingLeases.set(lease.id, lease);
    lease.start();
    void lease.settled.then((settlement) => {
      this.creatingLeases.delete(lease.id);
      if (settlement.cleanupFailed) this.failedCreationLeases.set(lease.id, lease);
      else this.failedCreationLeases.delete(lease.id);
      this.processQueue();
    });
    return lease.result;
  }

  private publishInstance(instance: IContainerInstance): boolean {
    if (this.isDraining || this.activeInstances.has(instance.containerId)) return false;
    this.activeInstances.set(instance.containerId, {
      instance,
      releasePromise: undefined,
      cleanupFailed: false,
    });
    return true;
  }

  private processQueue(): void {
    if (this.isDraining) return;
    while (this.hasCapacity()) {
      const request = this.queue.takeNext();
      if (request === undefined) return;
      void this.startCreation(request.config, request.signal).then(request.resolve, request.reject);
    }
  }

  private releaseRecord(containerId: string, record: ActiveContainerRecord): Promise<void> {
    if (record.releasePromise !== undefined) return record.releasePromise;
    const releaseAttempt = record.instance.teardown().then(
      () => {
        this.activeInstances.delete(containerId);
        this.retiredInstances.add(record.instance);
        this.processQueue();
      },
      (error: unknown) => {
        record.cleanupFailed = true;
        throw asError(error);
      },
    );
    record.releasePromise = releaseAttempt;
    void releaseAttempt.then(
      () => {
        record.releasePromise = undefined;
      },
      () => {
        record.releasePromise = undefined;
      },
    );
    return releaseAttempt;
  }

  private async completeDrain(drainReason: DrainInitiatedError): Promise<void> {
    for (;;) {
      for (const lease of this.creatingLeases.values()) {
        lease.cancel(drainReason);
      }
      const failures = await this.drainSnapshot();
      if (failures.length > 0) throw new ContainerDrainError(failures);
      if (
        this.creatingLeases.size === 0 &&
        this.failedCreationLeases.size === 0 &&
        this.activeInstances.size === 0
      ) {
        return;
      }
    }
  }

  private async drainSnapshot(): Promise<Error[]> {
    const pendingSettlements = Array.from(this.creatingLeases.values(), (lease) => lease.settled);
    const failedCreationRetries = Array.from(
      this.failedCreationLeases.entries(),
      async ([id, lease]) => {
        await lease.retryCleanup();
        this.failedCreationLeases.delete(id);
      },
    );
    const activeReleases = Array.from(this.activeInstances.entries(), ([id, record]) =>
      this.releaseRecord(id, record),
    );
    const results = await Promise.allSettled([
      ...pendingSettlements,
      ...failedCreationRetries,
      ...activeReleases,
    ]);
    const failures: Error[] = [];
    for (const result of results) {
      if (result.status === "rejected") failures.push(asError(result.reason));
      if (result.status === "fulfilled" && isCleanupFailedSettlement(result.value)) {
        failures.push(new Error("Container creation cleanup remains incomplete"));
      }
    }
    return failures;
  }

  private async enforceStartupJitter(signal: AbortSignal): Promise<void> {
    const previousLock = this.startupLock;
    let releaseLock: (() => void) | undefined;
    this.startupLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    try {
      await awaitSignalSettlement(previousLock, signal);
      const waitMs = Math.max(0, this.startupJitterMs - (Date.now() - this.lastCreationTimestamp));
      await this.waitForStartupJitter(waitMs, signal);
      if (signal.aborted) throw resolvePoolAbortReason(signal);
      this.lastCreationTimestamp = Date.now();
    } finally {
      releaseLock?.();
    }
  }
}

async function waitForAbortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw resolvePoolAbortReason(signal);
  if (delayMs === 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => settle(resolve), delayMs);
    const abort = (): void => settle(() => reject(resolvePoolAbortReason(signal)));
    const settle = (action: () => void): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      action();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function awaitSignalSettlement(operation: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw resolvePoolAbortReason(signal);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      action();
    };
    const abort = (): void => settle(() => reject(resolvePoolAbortReason(signal)));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      () => settle(resolve),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function resolvePoolAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : resolveAbortReason(signal, "sweep");
}

function isCleanupFailedSettlement(value: unknown): value is { readonly cleanupFailed: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "cleanupFailed" in value &&
    value.cleanupFailed === true
  );
}

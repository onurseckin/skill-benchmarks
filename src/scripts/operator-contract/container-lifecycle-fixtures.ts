import { resolveAbortReason } from "../../shared/cancellation.js";
import { DockerError } from "../../infrastructure/container/docker-errors.js";
import { waitForFixturePhase } from "./fixture-phase-deadline.js";
import type {
  ContainerInspectInfo,
  ContainerLaunchConfig,
  ContainerQueueTimer,
  DockerCreateOptions,
  DockerExecOptions,
  DockerExecProcessResult,
  DockerOperationOptions,
  IDockerClient,
  VolumeInspectInfo,
} from "../../infrastructure/container/types.js";

export type DockerFixturePhase =
  | "create-volume"
  | "create-container"
  | "start-container"
  | "remove-container"
  | "remove-volume";

const leaseLabelKey = "io.skill-benchmarks.lease-id";

class DeferredValue {
  public readonly promise: Promise<void>;
  private resolvePromise: () => void = () => {};

  public constructor() {
    this.promise = new Promise<void>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  public resolve(): void {
    this.resolvePromise();
  }
}

export class ManualQueueTimer implements ContainerQueueTimer {
  private nextHandle = 0;
  private readonly callbacks = new Map<number, () => void>();

  public schedule(callback: () => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  public cancel(handle: unknown): void {
    if (typeof handle === "number") this.callbacks.delete(handle);
  }

  public fireAll(): void {
    const callbacks = Array.from(this.callbacks.values());
    this.callbacks.clear();
    for (const callback of callbacks) callback();
  }

  public get activeCount(): number {
    return this.callbacks.size;
  }
}

export class FakeDockerClient implements IDockerClient {
  public readonly calls: string[] = [];
  public readonly volumes = new Set<string>();
  public readonly containers = new Set<string>();
  private readonly deferredPhases = new Map<DockerFixturePhase, DeferredValue>();
  private readonly phaseCallbacks = new Map<DockerFixturePhase, () => void>();
  private readonly phaseWaiters = new Map<DockerFixturePhase, DeferredValue>();
  private readonly reachedPhases = new Set<DockerFixturePhase>();
  private readonly failures = new Map<DockerFixturePhase, number>();
  private readonly containerNames = new Map<string, string>();
  private readonly containerLabels = new Map<string, Record<string, string>>();
  private readonly volumeLabels = new Map<string, Record<string, string>>();
  private conflictNextContainerCreation = false;
  private activePhaseDeadlineListeners = 0;
  private nextContainerNumber = 0;

  public hold(phase: DockerFixturePhase): void {
    this.deferredPhases.set(phase, new DeferredValue());
  }

  public release(phase: DockerFixturePhase): void {
    this.deferredPhases.get(phase)?.resolve();
    this.deferredPhases.delete(phase);
  }

  public failNext(phase: DockerFixturePhase): void {
    this.failures.set(phase, (this.failures.get(phase) ?? 0) + 1);
  }

  public conflictNextContainer(): void {
    this.conflictNextContainerCreation = true;
  }

  public afterPhase(phase: DockerFixturePhase, callback: () => void): void {
    this.phaseCallbacks.set(phase, callback);
  }

  public waitForPhase(phase: DockerFixturePhase, deadlineSignal?: AbortSignal): Promise<void> {
    if (this.reachedPhases.has(phase)) return Promise.resolve();
    let waiter = this.phaseWaiters.get(phase);
    if (waiter === undefined) {
      waiter = new DeferredValue();
      this.phaseWaiters.set(phase, waiter);
    }
    return waitForFixturePhase(
      phase,
      waiter.promise,
      deadlineSignal,
      () => {
        this.activePhaseDeadlineListeners += 1;
      },
      () => {
        this.activePhaseDeadlineListeners -= 1;
      },
    );
  }

  public get phaseDeadlineListenerCount(): number {
    return this.activePhaseDeadlineListeners;
  }

  public callCount(phase: DockerFixturePhase): number {
    return this.calls.filter((call) => call.startsWith(`${phase}:`)).length;
  }

  public hasCall(prefix: string): boolean {
    return this.calls.some((call) => call.startsWith(prefix));
  }

  public async createContainer(
    options: DockerCreateOptions,
    operation?: DockerOperationOptions,
  ): Promise<string> {
    this.calls.push(`create-container:${options.name}`);
    if (this.conflictNextContainerCreation) {
      this.conflictNextContainerCreation = false;
      this.containers.add(options.name);
      this.containerLabels.set(options.name, {
        ...options.labels,
        [leaseLabelKey]: "external-lease-uuid",
      });
      throw new DockerError(
        ["docker", "create"],
        1,
        "Conflict. The container name is already in use",
      );
    }
    if (this.containers.has(options.name)) {
      throw new DockerError(
        ["docker", "create"],
        1,
        "Conflict. The container name is already in use",
      );
    }
    const containerId = `fake-container-${this.nextContainerNumber++}`;
    this.containers.add(options.name);
    this.containerNames.set(containerId, options.name);
    this.containerLabels.set(options.name, { ...options.labels });
    await this.awaitPhase("create-container", operation?.signal);
    this.throwFailure("create-container");
    return containerId;
  }

  public async startContainer(
    containerId: string,
    operation?: DockerOperationOptions,
  ): Promise<void> {
    this.calls.push(`start-container:${containerId}`);
    this.markPhaseReached("start-container");
    await this.awaitPhase("start-container", operation?.signal);
    this.runPhaseCallback("start-container");
    this.throwFailure("start-container");
  }

  public async exec(
    _containerId: string,
    _command: ReadonlyArray<string>,
    _options?: DockerExecOptions,
  ): Promise<DockerExecProcessResult> {
    return {
      exitCode: 0,
      stdout: new Uint8Array(),
      stderr: new Uint8Array(),
      durationMs: 0,
      timedOut: false,
    };
  }

  public async inspectContainer(containerId: string): Promise<ContainerInspectInfo> {
    const containerName = this.containerNames.get(containerId) ?? containerId;
    if (!this.containers.has(containerName)) {
      throw new DockerError(["docker", "inspect", containerId], 1, "No such container");
    }
    return {
      id: containerId,
      name: containerName,
      state: {
        status: "running",
        running: true,
        exitCode: 0,
        oomKilled: false,
        startedAt: "",
        finishedAt: "",
      },
      created: "",
      config: { labels: this.containerLabels.get(containerName) ?? {}, image: "fake", env: [] },
    };
  }

  public async killContainer(
    containerId: string,
    _signal?: string,
    _operation?: DockerOperationOptions,
  ): Promise<void> {
    this.calls.push(`kill-container:${containerId}`);
  }

  public async removeContainer(
    containerId: string,
    _options?: { readonly force?: boolean; readonly removeVolumes?: boolean },
    _operation?: DockerOperationOptions,
  ): Promise<void> {
    this.calls.push(`remove-container:${containerId}`);
    await this.awaitPhase("remove-container");
    this.throwFailure("remove-container");
    const containerName = this.containerNames.get(containerId) ?? containerId;
    this.containers.delete(containerName);
    this.containerLabels.delete(containerName);
    for (const [id, name] of this.containerNames) {
      if (name === containerName) this.containerNames.delete(id);
    }
  }

  public async createVolume(
    name: string,
    _options?: { readonly labels?: Record<string, string> },
    operation?: DockerOperationOptions,
  ): Promise<void> {
    this.calls.push(`create-volume:${name}`);
    if (!this.volumes.has(name)) {
      this.volumes.add(name);
      this.volumeLabels.set(name, { ..._options?.labels });
    }
    await this.awaitPhase("create-volume", operation?.signal);
    this.throwFailure("create-volume");
  }

  public async removeVolume(
    name: string,
    _options?: { readonly force?: boolean },
    _operation?: DockerOperationOptions,
  ): Promise<void> {
    this.calls.push(`remove-volume:${name}`);
    await this.awaitPhase("remove-volume");
    this.throwFailure("remove-volume");
    this.volumes.delete(name);
    this.volumeLabels.delete(name);
  }

  public async listContainers(): Promise<ReadonlyArray<ContainerInspectInfo>> {
    return [];
  }

  public async listVolumes(options?: {
    readonly filters?: Record<string, string | ReadonlyArray<string>>;
  }): Promise<ReadonlyArray<VolumeInspectInfo>> {
    return Array.from(this.volumes, (name) => ({
      name,
      driver: "local",
      labels: this.volumeLabels.get(name) ?? {},
    })).filter((volume) => matchesVolumeFilters(volume, options?.filters));
  }

  public get resourceCount(): number {
    return this.containers.size + this.volumes.size;
  }

  private async awaitPhase(phase: DockerFixturePhase, signal?: AbortSignal): Promise<void> {
    await this.deferredPhases.get(phase)?.promise;
    if (signal?.aborted === true) {
      throw signal.reason instanceof Error ? signal.reason : resolveAbortReason(signal, "sweep");
    }
  }

  private throwFailure(phase: DockerFixturePhase): void {
    const remaining = this.failures.get(phase) ?? 0;
    if (remaining === 0) return;
    this.failures.set(phase, remaining - 1);
    throw new Error(`Fake Docker ${phase} failure`);
  }

  private runPhaseCallback(phase: DockerFixturePhase): void {
    const callback = this.phaseCallbacks.get(phase);
    this.phaseCallbacks.delete(phase);
    callback?.();
  }

  private markPhaseReached(phase: DockerFixturePhase): void {
    this.reachedPhases.add(phase);
    this.phaseWaiters.get(phase)?.resolve();
    this.phaseWaiters.delete(phase);
  }
}

function matchesVolumeFilters(
  volume: VolumeInspectInfo,
  filters: Record<string, string | ReadonlyArray<string>> | undefined,
): boolean {
  const labelFilter = filters?.label;
  if (labelFilter === undefined) return true;
  const labels = typeof labelFilter === "string" ? [labelFilter] : labelFilter;
  return labels.every((label) => {
    const separator = label.indexOf("=");
    const key = separator === -1 ? label : label.slice(0, separator);
    const value = separator === -1 ? undefined : label.slice(separator + 1);
    return value === undefined ? key in volume.labels : volume.labels[key] === value;
  });
}

let fixtureCounter = 0;

export function createLaunchConfig(): ContainerLaunchConfig {
  const sequence = fixtureCounter++;
  return {
    runId: `container-fixture-${sequence}`,
    scenarioId: "container-fixture",
    imageTag: "fake-image",
    resourceLimits: { cpus: 1, memoryMb: 64, pidsLimit: 32 },
    networkMode: "none",
    workspaceVolumeName: `fixture-volume-${sequence}`,
    artifactHostPath: `/tmp/container-fixture-${sequence}`,
    timeouts: {
      commandTimeoutMs: 100,
      turnTimeoutMs: 100,
      totalScenarioTimeoutMs: 100,
    },
  };
}

export async function waitForCall(dockerClient: FakeDockerClient, prefix: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (dockerClient.hasCall(prefix)) return;
    await Promise.resolve();
  }
  throw new Error(`Timed out waiting for fake Docker call '${prefix}'`);
}

export async function assertPending(promise: Promise<unknown>, label: string): Promise<void> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.resolve();
  if (settled) throw new Error(`Expected pending promise: ${label}`);
}

export async function expectFailure(
  promise: Promise<unknown>,
  expectedName?: string,
): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (expectedName !== undefined && failure.name !== expectedName) {
      throw new Error(`Expected ${expectedName}, received ${failure.name}`, { cause: failure });
    }
    return failure;
  }
  throw new Error("Expected promise rejection");
}

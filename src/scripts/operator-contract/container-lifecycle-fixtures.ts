import { resolveAbortReason } from "../../shared/cancellation.js";
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
  private readonly failures = new Map<DockerFixturePhase, number>();
  private readonly containerNames = new Map<string, string>();
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
    const containerId = `fake-container-${this.nextContainerNumber++}`;
    this.containers.add(options.name);
    this.containerNames.set(containerId, options.name);
    this.calls.push(`create-container:${options.name}`);
    await this.awaitPhase("create-container", operation?.signal);
    this.throwFailure("create-container");
    return containerId;
  }

  public async startContainer(
    containerId: string,
    operation?: DockerOperationOptions,
  ): Promise<void> {
    this.calls.push(`start-container:${containerId}`);
    await this.awaitPhase("start-container", operation?.signal);
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
    return {
      id: containerId,
      name: this.containerNames.get(containerId) ?? containerId,
      state: {
        status: "running",
        running: true,
        exitCode: 0,
        oomKilled: false,
        startedAt: "",
        finishedAt: "",
      },
      created: "",
      config: { labels: {}, image: "fake", env: [] },
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
    this.containers.delete(this.containerNames.get(containerId) ?? containerId);
  }

  public async createVolume(
    name: string,
    _options?: { readonly labels?: Record<string, string> },
    operation?: DockerOperationOptions,
  ): Promise<void> {
    this.volumes.add(name);
    this.calls.push(`create-volume:${name}`);
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
  }

  public async listContainers(): Promise<ReadonlyArray<ContainerInspectInfo>> {
    return [];
  }

  public async listVolumes(): Promise<ReadonlyArray<VolumeInspectInfo>> {
    return [];
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

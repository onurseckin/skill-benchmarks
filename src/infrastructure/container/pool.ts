import * as os from "node:os";
import { DockerClient } from "./docker-client.js";
import { ContainerInstance } from "./instance.js";
import { ContainerStateMachine } from "./state-machine.js";
import type {
  ContainerLaunchConfig,
  IContainerInstance,
  IContainerPoolManager,
  IDockerClient,
  PoolConfig,
} from "./types.js";

export class QueueTimeoutError extends Error {
  readonly queueTimeoutMs: number;

  constructor(queueTimeoutMs: number, message?: string) {
    super(
      message ?? `Container pool acquisition timed out after waiting ${queueTimeoutMs}ms in queue`,
    );
    this.name = "QueueTimeoutError";
    this.queueTimeoutMs = queueTimeoutMs;
  }
}

export class DrainInitiatedError extends Error {
  constructor(message?: string) {
    super(message ?? "Container pool is draining, acquisition cancelled");
    this.name = "DrainInitiatedError";
  }
}

interface QueuedRequest {
  readonly config: ContainerLaunchConfig;
  readonly resolve: (instance: IContainerInstance) => void;
  readonly reject: (error: Error) => void;
  readonly timerId: ReturnType<typeof setTimeout>;
  readonly queuedAt: number;
}

export class ContainerPoolManager implements IContainerPoolManager {
  private readonly _maxConcurrency: number;
  private readonly _startupJitterMs: number;
  private readonly _queueTimeoutMs: number;
  private readonly dockerClient: IDockerClient;

  private readonly activeInstances = new Map<string, IContainerInstance>();
  private readonly queue: QueuedRequest[] = [];
  private isDraining = false;
  private lastCreationTimestamp = 0;
  private creationLock: Promise<void> = Promise.resolve();

  constructor(config?: PoolConfig) {
    this._maxConcurrency = config?.maxConcurrency ?? ContainerPoolManager.calculateMaxConcurrency();
    this._startupJitterMs = config?.startupJitterMs ?? 150;
    this._queueTimeoutMs = config?.queueTimeoutMs ?? 300000;
    this.dockerClient = config?.dockerClient ?? new DockerClient();
  }

  get activeCount(): number {
    return this.activeInstances.size;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  get maxConcurrency(): number {
    return this._maxConcurrency;
  }

  static calculateMaxConcurrency(hostCpus?: number, totalMemoryBytes?: number): number {
    const cpus = hostCpus ?? (typeof os.cpus === "function" ? os.cpus().length : 4);
    const memBytes =
      totalMemoryBytes ??
      (typeof os.totalmem === "function" ? os.totalmem() : 16 * 1024 * 1024 * 1024);

    const totalMemoryGb = memBytes / (1024 * 1024 * 1024);
    const mFreeGb = Math.max(0, totalMemoryGb - 4.0);

    const memorySlots = Math.floor(mFreeGb / 2.5);
    const cpuSlots = cpus - 1;

    return Math.max(1, Math.min(cpuSlots, memorySlots));
  }

  private async enforceStartupJitter(): Promise<void> {
    const previousLock = this.creationLock;
    let releaseLock: () => void = () => {};
    this.creationLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    await previousLock;

    try {
      const now = Date.now();
      const elapsed = now - this.lastCreationTimestamp;
      if (elapsed < this._startupJitterMs) {
        const waitMs = this._startupJitterMs - elapsed;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      this.lastCreationTimestamp = Date.now();
    } finally {
      releaseLock();
    }
  }

  private async createContainerInstance(
    config: ContainerLaunchConfig,
  ): Promise<IContainerInstance> {
    await this.enforceStartupJitter();

    const stateMachine = new ContainerStateMachine("PENDING");
    stateMachine.transition("CREATING");

    if (config.workspaceVolumeName) {
      await this.dockerClient.createVolume(config.workspaceVolumeName, {
        labels: {
          "io.skill-benchmarks.volume": "workspace",
          "io.skill-benchmarks.run-id": config.runId,
          "io.skill-benchmarks.scenario-id": config.scenarioId,
        },
      });
    }

    const containerName = `sb-run-${config.runId}`;
    const bindMounts = config.artifactHostPath
      ? [
          {
            hostPath: config.artifactHostPath,
            containerPath: "/artifacts",
            readonly: false,
          },
        ]
      : [];

    const volumeMounts = config.workspaceVolumeName
      ? [
          {
            volumeName: config.workspaceVolumeName,
            containerPath: "/workspace",
            readonly: false,
          },
        ]
      : [];

    const labels: Record<string, string> = {
      "io.skill-benchmarks.managed": "true",
      "io.skill-benchmarks.run-id": config.runId,
      "io.skill-benchmarks.scenario-id": config.scenarioId,
      ...(config.labels ?? {}),
    };

    let containerId: string;
    try {
      containerId = await this.dockerClient.createContainer({
        name: containerName,
        image: config.imageTag,
        command: ["sleep", "infinity"],
        workingDir: "/workspace",
        environment: config.environment,
        labels,
        network: config.networkMode,
        bindMounts,
        volumeMounts,
        resourceLimits: config.resourceLimits,
        securityOpts: config.securityOpts,
        capDrop: config.capDrop,
        capAdd: config.capAdd,
        user: config.user ?? "sandbox",
      });

      await this.dockerClient.startContainer(containerId);
      stateMachine.transition("READY");
    } catch (err) {
      stateMachine.transition("ERRORED", (err as Error).message);
      throw err;
    }

    return new ContainerInstance(containerId, config, this.dockerClient, stateMachine);
  }

  async acquire(config: ContainerLaunchConfig): Promise<IContainerInstance> {
    if (this.isDraining) {
      throw new DrainInitiatedError();
    }

    if (this.activeInstances.size < this._maxConcurrency) {
      const placeholderKey = `pending-${config.runId}-${Date.now()}`;
      const dummyInstance: IContainerInstance = {
        containerId: placeholderKey,
        runId: config.runId,
        state: "CREATING",
        config,
        executeCommand: async () => {
          throw new Error("Not implemented");
        },
        readFile: async () => new Uint8Array(),
        writeFile: async () => {},
        extractGitDiff: async () => "",
        teardown: async () => {},
      };
      this.activeInstances.set(placeholderKey, dummyInstance);

      try {
        const instance = await this.createContainerInstance(config);
        this.activeInstances.delete(placeholderKey);
        this.activeInstances.set(instance.containerId, instance);
        return instance;
      } catch (err) {
        this.activeInstances.delete(placeholderKey);
        this.processNextInQueue();
        throw err;
      }
    }

    return new Promise<IContainerInstance>((resolve, reject) => {
      let timerId: ReturnType<typeof setTimeout>;

      timerId = setTimeout(() => {
        const idx = this.queue.findIndex((q) => q.timerId === timerId);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          reject(new QueueTimeoutError(this._queueTimeoutMs));
        }
      }, this._queueTimeoutMs);

      this.queue.push({
        config,
        resolve: (inst) => {
          clearTimeout(timerId);
          resolve(inst);
        },
        reject: (err) => {
          clearTimeout(timerId);
          reject(err);
        },
        timerId,
        queuedAt: Date.now(),
      });
    });
  }

  private processNextInQueue(): void {
    if (this.isDraining || this.queue.length === 0) {
      return;
    }

    if (this.activeInstances.size >= this._maxConcurrency) {
      return;
    }

    const next = this.queue.shift();
    if (!next) {
      return;
    }

    const placeholderKey = `pending-${next.config.runId}-${Date.now()}`;
    const dummyInstance: IContainerInstance = {
      containerId: placeholderKey,
      runId: next.config.runId,
      state: "CREATING",
      config: next.config,
      executeCommand: async () => {
        throw new Error("Not implemented");
      },
      readFile: async () => new Uint8Array(),
      writeFile: async () => {},
      extractGitDiff: async () => "",
      teardown: async () => {},
    };
    this.activeInstances.set(placeholderKey, dummyInstance);

    this.createContainerInstance(next.config)
      .then((instance) => {
        this.activeInstances.delete(placeholderKey);
        this.activeInstances.set(instance.containerId, instance);
        next.resolve(instance);
      })
      .catch((err) => {
        this.activeInstances.delete(placeholderKey);
        next.reject(err);
        this.processNextInQueue();
      });
  }

  async release(instance: IContainerInstance): Promise<void> {
    this.activeInstances.delete(instance.containerId);

    try {
      await instance.teardown();
    } catch {
    } finally {
      this.processNextInQueue();
    }
  }

  async drain(): Promise<void> {
    this.isDraining = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        clearTimeout(item.timerId);
        item.reject(new DrainInitiatedError());
      }
    }

    const activeList = Array.from(this.activeInstances.values());
    this.activeInstances.clear();

    await Promise.all(
      activeList.map(async (instance) => {
        try {
          await instance.teardown();
        } catch {}
      }),
    );
  }
}

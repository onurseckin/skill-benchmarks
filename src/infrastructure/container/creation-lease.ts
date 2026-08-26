import { resolveAbortReason } from "../../shared/cancellation.js";
import { ContainerInstance } from "./instance.js";
import { DockerError } from "./docker-errors.js";
import { ContainerCleanupError, ContainerOwnershipError } from "./pool-errors.js";
import { ContainerStateMachine } from "./state-machine.js";
import type {
  ContainerLaunchConfig,
  IDockerClient,
  IContainerInstance,
  VolumeInspectInfo,
} from "./types.js";

const leaseLabelKey = "io.skill-benchmarks.lease-id";

export type ContainerCreationSettlement =
  | { readonly state: "published"; readonly cleanupFailed: false }
  | { readonly state: "cancelled" | "failed"; readonly cleanupFailed: boolean };

export interface ContainerCreationLeaseOptions {
  readonly id: string;
  readonly config: ContainerLaunchConfig;
  readonly dockerClient: IDockerClient;
  readonly signal?: AbortSignal;
  readonly waitForStartupJitter: (signal: AbortSignal) => Promise<void>;
  readonly publish: (instance: IContainerInstance) => boolean;
}

export class ContainerCreationLease {
  public readonly id: string;
  public readonly result: Promise<IContainerInstance>;
  public readonly settled: Promise<ContainerCreationSettlement>;

  private readonly controller = new AbortController();
  private readonly config: ContainerLaunchConfig;
  private readonly dockerClient: IDockerClient;
  private readonly waitForStartupJitter: (signal: AbortSignal) => Promise<void>;
  private readonly publish: (instance: IContainerInstance) => boolean;
  private readonly containerName: string;
  private readonly volumeName: string;
  private readonly instanceConfig: ContainerLaunchConfig;
  private readonly removeCallerAbortListener: () => void;
  private resolveResult: (instance: IContainerInstance) => void = () => {};
  private rejectResult: (error: Error) => void = () => {};
  private resolveSettlement: (settlement: ContainerCreationSettlement) => void = () => {};
  private settledOnce = false;
  private volumeCreationRequested = false;
  private volumeOwned = false;
  private containerCreationRequested = false;
  private containerOwned = false;
  private containerReference: string;
  private cleanupPromise: Promise<void> | undefined;

  public constructor(options: ContainerCreationLeaseOptions) {
    this.id = options.id;
    this.config = options.config;
    this.dockerClient = options.dockerClient;
    this.waitForStartupJitter = options.waitForStartupJitter;
    this.publish = options.publish;
    this.containerName = `sb-container-${this.id}`;
    this.volumeName = this.config.workspaceVolumeName.length > 0 ? `sb-volume-${this.id}` : "";
    this.instanceConfig = { ...this.config, workspaceVolumeName: this.volumeName };
    this.containerReference = this.containerName;
    this.removeCallerAbortListener = this.connectCallerSignal(options.signal);
    this.result = new Promise<IContainerInstance>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    this.settled = new Promise<ContainerCreationSettlement>((resolve) => {
      this.resolveSettlement = resolve;
    });
  }

  public start(): void {
    void this.execute();
  }

  public cancel(reason: Error): void {
    if (!this.controller.signal.aborted) this.controller.abort(reason);
  }

  public async retryCleanup(): Promise<void> {
    await this.cleanupOwnedResources();
  }

  private connectCallerSignal(signal: AbortSignal | undefined): () => void {
    if (signal === undefined) return () => {};
    const abort = (): void => this.cancel(resolveAbortReason(signal, "sweep"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    return (): void => signal.removeEventListener("abort", abort);
  }

  private async execute(): Promise<void> {
    try {
      this.throwIfCancelled();
      await this.waitForStartupJitter(this.controller.signal);
      this.throwIfCancelled();
      await this.createVolume();
      this.throwIfCancelled();
      const containerId = await this.createContainer();
      this.containerReference = containerId;
      this.throwIfCancelled();
      await this.dockerClient.startContainer(containerId, { signal: this.controller.signal });
      this.throwIfCancelled();
      const instance = new ContainerInstance(
        containerId,
        this.instanceConfig,
        this.dockerClient,
        this.createReadyStateMachine(),
      );
      if (!this.publish(instance)) {
        throw this.controller.signal.reason instanceof Error
          ? this.controller.signal.reason
          : new Error("Container creation was not admitted for publication");
      }
      this.resolveResult(instance);
      this.settle({ state: "published", cleanupFailed: false });
    } catch (error) {
      await this.rejectAfterCleanup(this.resolveFailure(error));
    } finally {
      this.removeCallerAbortListener();
    }
  }

  private async createVolume(): Promise<void> {
    if (this.volumeName.length === 0) return;
    this.volumeCreationRequested = true;
    await this.dockerClient.createVolume(
      this.volumeName,
      {
        labels: this.createVolumeLabels(),
      },
      { signal: this.controller.signal },
    );
    if (!(await this.hasOwnedVolume())) {
      throw new ContainerOwnershipError(`Volume reservation '${this.volumeName}' is not owned`);
    }
    this.volumeOwned = true;
  }

  private async createContainer(): Promise<string> {
    this.containerCreationRequested = true;
    const containerId = await this.dockerClient.createContainer(
      {
        name: this.containerName,
        image: this.config.imageTag,
        command: ["sleep", "infinity"],
        workingDir: "/workspace",
        environment: this.config.environment,
        labels: this.createContainerLabels(),
        network: this.config.networkMode,
        bindMounts: this.createBindMounts(),
        volumeMounts: this.createVolumeMounts(),
        resourceLimits: this.config.resourceLimits,
        securityOpts: this.config.securityOpts,
        capDrop: this.config.capDrop,
        capAdd: this.config.capAdd,
        user: this.config.user ?? "sandbox",
      },
      { signal: this.controller.signal },
    );
    this.containerReference = containerId;
    if (!(await this.hasOwnedContainer(containerId))) {
      throw new ContainerOwnershipError(
        `Container reservation '${this.containerName}' is not owned`,
      );
    }
    this.containerOwned = true;
    return containerId;
  }

  private createBindMounts() {
    if (this.config.artifactHostPath.length === 0) return [];
    return [
      {
        hostPath: this.config.artifactHostPath,
        containerPath: "/artifacts",
        readonly: false,
      },
    ];
  }

  private createVolumeMounts() {
    if (this.volumeName.length === 0) return [];
    return [
      {
        volumeName: this.volumeName,
        containerPath: "/workspace",
        readonly: false,
      },
    ];
  }

  private createReadyStateMachine(): ContainerStateMachine {
    const stateMachine = new ContainerStateMachine("PENDING");
    stateMachine.transition("CREATING");
    stateMachine.transition("READY");
    return stateMachine;
  }

  private throwIfCancelled(): void {
    if (this.controller.signal.aborted) throw this.resolveFailure(this.controller.signal.reason);
  }

  private resolveFailure(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(String(error));
  }

  private async rejectAfterCleanup(primaryError: Error): Promise<void> {
    const cancellation = this.controller.signal.aborted;
    try {
      await this.cleanupOwnedResources();
      this.settle({
        state: cancellation ? "cancelled" : "failed",
        cleanupFailed: false,
      });
      this.rejectResult(primaryError);
    } catch (cleanupError) {
      const cleanupFailure = this.resolveFailure(cleanupError);
      this.settle({
        state: cancellation ? "cancelled" : "failed",
        cleanupFailed: true,
      });
      this.rejectResult(
        new ContainerCleanupError("Container creation failed and cleanup remains incomplete", [
          primaryError,
          cleanupFailure,
        ]),
      );
    }
  }

  private cleanupOwnedResources(): Promise<void> {
    if (this.cleanupPromise !== undefined) return this.cleanupPromise;
    const cleanupPromise = this.removeOwnedResources();
    this.cleanupPromise = cleanupPromise;
    void cleanupPromise.then(
      () => {
        this.cleanupPromise = undefined;
      },
      () => {
        this.cleanupPromise = undefined;
      },
    );
    return cleanupPromise;
  }

  private async removeOwnedResources(): Promise<void> {
    const errors: Error[] = [];
    try {
      await this.claimLateOwnedResources();
    } catch (error) {
      errors.push(this.resolveFailure(error));
    }
    if (this.containerOwned) {
      await this.killContainer();
      try {
        await this.dockerClient.removeContainer(this.containerReference, {
          force: true,
          removeVolumes: true,
        });
        this.containerOwned = false;
      } catch (error) {
        errors.push(this.resolveFailure(error));
      }
    }
    if (this.volumeOwned) {
      try {
        await this.dockerClient.removeVolume(this.volumeName, { force: true });
        this.volumeOwned = false;
      } catch (error) {
        errors.push(this.resolveFailure(error));
      }
    }
    if (errors.length > 0) {
      throw new ContainerCleanupError("Container creation cleanup did not complete", errors);
    }
  }

  private async killContainer(): Promise<void> {
    try {
      await this.dockerClient.killContainer(this.containerReference);
    } catch {}
  }

  private createContainerLabels(): Record<string, string> {
    return {
      ...this.config.labels,
      "io.skill-benchmarks.managed": "true",
      "io.skill-benchmarks.run-id": this.config.runId,
      "io.skill-benchmarks.scenario-id": this.config.scenarioId,
      [leaseLabelKey]: this.id,
    };
  }

  private createVolumeLabels(): Record<string, string> {
    return {
      "io.skill-benchmarks.volume": "workspace",
      "io.skill-benchmarks.run-id": this.config.runId,
      "io.skill-benchmarks.scenario-id": this.config.scenarioId,
      [leaseLabelKey]: this.id,
    };
  }

  private async claimLateOwnedResources(): Promise<void> {
    if (this.containerCreationRequested && !this.containerOwned) {
      this.containerOwned = await this.hasOwnedContainer(this.containerName);
      if (this.containerOwned) this.containerReference = this.containerName;
    }
    if (this.volumeCreationRequested && !this.volumeOwned) {
      this.volumeOwned = await this.hasOwnedVolume();
    }
  }

  private async hasOwnedContainer(reference: string): Promise<boolean> {
    try {
      const container = await this.dockerClient.inspectContainer(reference);
      return this.hasOwnershipLabels(container.config.labels);
    } catch (error) {
      if (isDockerResourceAbsent(error)) return false;
      throw error;
    }
  }

  private async hasOwnedVolume(): Promise<boolean> {
    const volumes = await this.dockerClient.listVolumes({
      filters: { label: `${leaseLabelKey}=${this.id}` },
    });
    return volumes.some((volume) => this.isOwnedVolume(volume));
  }

  private isOwnedVolume(volume: VolumeInspectInfo): boolean {
    return volume.name === this.volumeName && this.hasOwnershipLabels(volume.labels);
  }

  private hasOwnershipLabels(labels: Record<string, string>): boolean {
    return (
      labels[leaseLabelKey] === this.id &&
      labels["io.skill-benchmarks.run-id"] === this.config.runId &&
      labels["io.skill-benchmarks.scenario-id"] === this.config.scenarioId
    );
  }

  private settle(settlement: ContainerCreationSettlement): void {
    if (this.settledOnce) return;
    this.settledOnce = true;
    this.resolveSettlement(settlement);
  }
}

function isDockerResourceAbsent(error: unknown): boolean {
  return error instanceof DockerError && /no such (container|object)/i.test(error.stderr);
}

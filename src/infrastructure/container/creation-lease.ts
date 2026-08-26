import { resolveAbortReason } from "../../shared/cancellation.js";
import { ContainerInstance } from "./instance.js";
import { ContainerCleanupError } from "./pool-errors.js";
import { ContainerStateMachine } from "./state-machine.js";
import type { ContainerLaunchConfig, IDockerClient, IContainerInstance } from "./types.js";

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
  private readonly removeCallerAbortListener: () => void;
  private resolveResult: (instance: IContainerInstance) => void = () => {};
  private rejectResult: (error: Error) => void = () => {};
  private resolveSettlement: (settlement: ContainerCreationSettlement) => void = () => {};
  private settledOnce = false;
  private volumeMayExist = false;
  private containerMayExist = false;
  private containerReference: string;
  private cleanupPromise: Promise<void> | undefined;

  public constructor(options: ContainerCreationLeaseOptions) {
    this.id = options.id;
    this.config = options.config;
    this.dockerClient = options.dockerClient;
    this.waitForStartupJitter = options.waitForStartupJitter;
    this.publish = options.publish;
    this.containerName = `sb-run-${this.config.runId}`;
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
        this.config,
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
    this.volumeMayExist = this.config.workspaceVolumeName.length > 0;
    if (!this.volumeMayExist) return;
    await this.dockerClient.createVolume(
      this.config.workspaceVolumeName,
      {
        labels: {
          "io.skill-benchmarks.volume": "workspace",
          "io.skill-benchmarks.run-id": this.config.runId,
          "io.skill-benchmarks.scenario-id": this.config.scenarioId,
        },
      },
      { signal: this.controller.signal },
    );
  }

  private async createContainer(): Promise<string> {
    this.containerMayExist = true;
    return await this.dockerClient.createContainer(
      {
        name: this.containerName,
        image: this.config.imageTag,
        command: ["sleep", "infinity"],
        workingDir: "/workspace",
        environment: this.config.environment,
        labels: {
          "io.skill-benchmarks.managed": "true",
          "io.skill-benchmarks.run-id": this.config.runId,
          "io.skill-benchmarks.scenario-id": this.config.scenarioId,
          ...this.config.labels,
        },
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
    if (this.config.workspaceVolumeName.length === 0) return [];
    return [
      {
        volumeName: this.config.workspaceVolumeName,
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
    if (this.containerMayExist) {
      await this.killContainer();
      try {
        await this.dockerClient.removeContainer(this.containerReference, {
          force: true,
          removeVolumes: true,
        });
        this.containerMayExist = false;
      } catch (error) {
        errors.push(this.resolveFailure(error));
      }
    }
    if (this.volumeMayExist) {
      try {
        await this.dockerClient.removeVolume(this.config.workspaceVolumeName, { force: true });
        this.volumeMayExist = false;
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

  private settle(settlement: ContainerCreationSettlement): void {
    if (this.settledOnce) return;
    this.settledOnce = true;
    this.resolveSettlement(settlement);
  }
}

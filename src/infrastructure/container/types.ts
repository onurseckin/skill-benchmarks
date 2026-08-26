export type ContainerState =
  | "PENDING"
  | "CREATING"
  | "HYDRATING"
  | "READY"
  | "EXECUTING"
  | "EXTRACTING"
  | "TEARDOWN"
  | "TERMINATED"
  | "ERRORED";

export type NetworkMode = "none" | "sb-bridge-isolated" | "sb-bridge-proxied";

export interface ResourceLimits {
  readonly cpus: number;
  readonly memoryMb: number;
  readonly pidsLimit: number;
  readonly cpuShares?: number;
  readonly memorySwapMb?: number;
  readonly memoryReservationMb?: number;
  readonly storageOptSize?: string;
}

export interface ContainerLaunchConfig {
  readonly runId: string;
  readonly scenarioId: string;
  readonly imageTag: string;
  readonly resourceLimits: ResourceLimits;
  readonly networkMode: NetworkMode;
  readonly workspaceVolumeName: string;
  readonly artifactHostPath: string;
  readonly environment?: Record<string, string>;
  readonly timeouts: {
    readonly commandTimeoutMs: number;
    readonly turnTimeoutMs: number;
    readonly totalScenarioTimeoutMs: number;
  };
  readonly labels?: Record<string, string>;
  readonly user?: string;
  readonly securityOpts?: ReadonlyArray<string>;
  readonly capDrop?: ReadonlyArray<string>;
  readonly capAdd?: ReadonlyArray<string>;
}

export interface ContainerExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly executionTimeMs: number;
  readonly peakMemoryBytes: number;
  readonly timedOut: boolean;
  readonly oomKilled: boolean;
}

export interface ExecuteCommandOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly env?: Record<string, string>;
  readonly user?: string;
  readonly onStdoutChunk?: (chunk: Uint8Array) => void;
  readonly onStderrChunk?: (chunk: Uint8Array) => void;
}

export interface IContainerInstance {
  readonly containerId: string;
  readonly runId: string;
  readonly state: ContainerState;
  readonly config: ContainerLaunchConfig;

  executeCommand(command: string, options?: ExecuteCommandOptions): Promise<ContainerExecResult>;

  readFile(path: string): Promise<Uint8Array>;

  writeFile(path: string, content: Uint8Array | string): Promise<void>;

  extractGitDiff(): Promise<string>;

  teardown(): Promise<void>;
}

export interface IContainerPoolManager {
  readonly activeCount: number;
  readonly queuedCount: number;
  readonly maxConcurrency: number;

  acquire(config: ContainerLaunchConfig): Promise<IContainerInstance>;

  release(instance: IContainerInstance): Promise<void>;

  drain(): Promise<void>;
}

export interface PoolConfig {
  readonly maxConcurrency?: number;
  readonly startupJitterMs?: number;
  readonly queueTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly dockerClient?: IDockerClient;
}

export interface ContainerInspectState {
  readonly status: string;
  readonly running: boolean;
  readonly exitCode: number;
  readonly oomKilled: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface ContainerInspectInfo {
  readonly id: string;
  readonly name: string;
  readonly state: ContainerInspectState;
  readonly created: string;
  readonly config: {
    readonly labels: Record<string, string>;
    readonly image: string;
    readonly env: ReadonlyArray<string>;
  };
}

export interface VolumeInspectInfo {
  readonly name: string;
  readonly driver: string;
  readonly labels: Record<string, string>;
  readonly createdAt?: string;
}

export interface DockerBindMount {
  readonly hostPath: string;
  readonly containerPath: string;
  readonly readonly?: boolean;
}

export interface DockerVolumeMount {
  readonly volumeName: string;
  readonly containerPath: string;
  readonly readonly?: boolean;
}

export interface DockerCreateOptions {
  readonly name: string;
  readonly image: string;
  readonly command?: ReadonlyArray<string>;
  readonly entrypoint?: ReadonlyArray<string>;
  readonly user?: string;
  readonly workingDir?: string;
  readonly environment?: Record<string, string>;
  readonly labels?: Record<string, string>;
  readonly network?: string;
  readonly bindMounts?: ReadonlyArray<DockerBindMount>;
  readonly volumeMounts?: ReadonlyArray<DockerVolumeMount>;
  readonly resourceLimits?: ResourceLimits;
  readonly securityOpts?: ReadonlyArray<string>;
  readonly capDrop?: ReadonlyArray<string>;
  readonly capAdd?: ReadonlyArray<string>;
  readonly autoRemove?: boolean;
}

export interface DockerExecOptions {
  readonly cwd?: string;
  readonly user?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly onStdoutChunk?: (chunk: Uint8Array) => void;
  readonly onStderrChunk?: (chunk: Uint8Array) => void;
}

export interface DockerExecProcessResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export interface IDockerClient {
  createContainer(options: DockerCreateOptions): Promise<string>;
  startContainer(containerId: string): Promise<void>;
  exec(
    containerId: string,
    command: ReadonlyArray<string>,
    options?: DockerExecOptions,
  ): Promise<DockerExecProcessResult>;
  inspectContainer(containerId: string): Promise<ContainerInspectInfo>;
  killContainer(containerId: string, signal?: string): Promise<void>;
  removeContainer(
    containerId: string,
    options?: { readonly force?: boolean; readonly removeVolumes?: boolean },
  ): Promise<void>;
  createVolume(name: string, options?: { readonly labels?: Record<string, string> }): Promise<void>;
  removeVolume(name: string, options?: { readonly force?: boolean }): Promise<void>;
  listContainers(options?: {
    readonly all?: boolean;
    readonly filters?: Record<string, string | ReadonlyArray<string>>;
  }): Promise<ReadonlyArray<ContainerInspectInfo>>;
  listVolumes(options?: {
    readonly filters?: Record<string, string | ReadonlyArray<string>>;
  }): Promise<ReadonlyArray<VolumeInspectInfo>>;
}

export interface GCReport {
  readonly prunedContainers: ReadonlyArray<string>;
  readonly prunedVolumes: ReadonlyArray<string>;
  readonly errors: ReadonlyArray<string>;
  readonly durationMs: number;
}

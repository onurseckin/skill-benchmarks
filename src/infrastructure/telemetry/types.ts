export type TelemetryEventType =
  | "CONTAINER_SPAWNED"
  | "WORKSPACE_HYDRATED"
  | "TOOL_CALL_STARTED"
  | "TOOL_STDOUT_CHUNK"
  | "TOOL_STDERR_CHUNK"
  | "TOOL_CALL_COMPLETED"
  | "RESOURCE_SAMPLE"
  | "GIT_DIFF_CAPTURED"
  | "CONTAINER_TEARDOWN";

export interface TelemetryEvent {
  readonly runId: string;
  readonly sequenceNumber: number;
  readonly timestampUs: string;
  readonly type: TelemetryEventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ResourceProfileSample {
  readonly timestampMs: number;
  readonly cpuPercent: number;
  readonly cpuUserUs: number;
  readonly cpuKernelUs: number;
  readonly memoryRssBytes: number;
  readonly memoryCacheBytes: number;
  readonly memoryLimitBytes: number;
  readonly memoryPercent: number;
  readonly diskReadBytes: number;
  readonly diskWriteBytes: number;
  readonly networkRxBytes: number;
  readonly networkTxBytes: number;
  readonly activePids: number;
}

export interface ResourceMetricsSummary {
  readonly cpu: {
    readonly peakPercent: number;
    readonly meanPercent: number;
    readonly totalCpuTimeMs: number;
  };
  readonly memory: {
    readonly peakRssBytes: number;
    readonly peakRssMb: number;
    readonly finalRssBytes: number;
    readonly limitBytes: number;
    readonly peakMemoryPercentage: number;
  };
  readonly io: {
    readonly totalDiskReadBytes: number;
    readonly totalDiskWriteBytes: number;
    readonly totalNetworkRxBytes: number;
    readonly totalNetworkTxBytes: number;
  };
  readonly processes: {
    readonly peakPidCount: number;
  };
}

export type ErrorCategory =
  | "INFRASTRUCTURE_FAULT"
  | "EXECUTION_TIMEOUT"
  | "AGENT_TOOL_ERROR"
  | "STATE_INTEGRITY_ERROR";

export type InfrastructureErrorCode =
  | "ERR_DOCKER_DAEMON_UNAVAILABLE"
  | "ERR_IMAGE_PULL_FAILED"
  | "ERR_VOLUME_CREATION_FAILED"
  | "ERR_CONTAINER_BOOT_TIMEOUT"
  | "ERR_OOM_KILLED"
  | "ERR_COMMAND_TIMEOUT"
  | "ERR_TURN_TIMEOUT"
  | "ERR_SCENARIO_TIMEOUT"
  | "ERR_INVALID_TOOL_PAYLOAD"
  | "ERR_COMMAND_NON_ZERO_EXIT"
  | "ERR_OUTPUT_LIMIT_EXCEEDED"
  | "ERR_DIFF_EXTRACTION_FAILED"
  | "ERR_BASELINE_TAMPERING";

export interface InfrastructureError {
  readonly code: InfrastructureErrorCode;
  readonly category: ErrorCategory;
  readonly message: string;
  readonly timestampUs: string;
  readonly isRetryable: boolean;
  readonly exitCode?: number;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly stack?: string;
}

export interface ContainerInspectDiagnostic {
  readonly status: string;
  readonly running: boolean;
  readonly exitCode: number;
  readonly oomKilled: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly error?: string;
}

export interface DiagnosticRecord {
  readonly runId: string;
  readonly containerId?: string;
  readonly capturedAt: string;
  readonly error?: InfrastructureError;
  readonly containerInspect?: ContainerInspectDiagnostic;
  readonly dmesgTail: ReadonlyArray<string>;
  readonly lastStdoutLines: ReadonlyArray<string>;
  readonly lastStderrLines: ReadonlyArray<string>;
}

export interface DockerCpuStats {
  readonly cpu_usage: {
    readonly total_usage: number;
    readonly usage_in_usermode?: number;
    readonly usage_in_kernelmode?: number;
  };
  readonly system_cpu_usage?: number;
  readonly online_cpus?: number;
}

export interface DockerMemoryStats {
  readonly usage?: number;
  readonly max_usage?: number;
  readonly limit?: number;
  readonly stats?: {
    readonly cache?: number;
    readonly inactive_file?: number;
    readonly active_anon?: number;
    readonly inactive_anon?: number;
  };
}

export interface DockerBlkioStats {
  readonly io_service_bytes_recursive?: ReadonlyArray<{
    readonly major: number;
    readonly minor: number;
    readonly op: string;
    readonly value: number;
  }>;
}

export interface DockerNetworkStats {
  readonly rx_bytes: number;
  readonly tx_bytes: number;
  readonly rx_packets?: number;
  readonly tx_packets?: number;
  readonly rx_errors?: number;
  readonly tx_errors?: number;
  readonly rx_dropped?: number;
  readonly tx_dropped?: number;
}

export interface DockerStatsRaw {
  readonly read?: string;
  readonly preread?: string;
  readonly pids_stats?: {
    readonly current?: number;
  };
  readonly cpu_stats?: DockerCpuStats;
  readonly precpu_stats?: DockerCpuStats;
  readonly memory_stats?: DockerMemoryStats;
  readonly blkio_stats?: DockerBlkioStats;
  readonly networks?: Record<string, DockerNetworkStats>;
}

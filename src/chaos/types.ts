export type FaultInjectionKind =
  | "network_latency"
  | "packet_drop"
  | "process_kill"
  | "disk_pressure"
  | "cpu_throttle"
  | "oom_simulation"
  | "network_blackhole"
  | "io_throttle";

export type ChaosFaultSeverity = "low" | "medium" | "high" | "extreme";

export type ChaosFaultStatus =
  | "pending"
  | "injecting"
  | "active"
  | "recovering"
  | "restored"
  | "failed";

export type ChaosTriggerType =
  | "time_elapsed"
  | "before_tool_call"
  | "after_tool_call"
  | "turn_start"
  | "turn_end"
  | "metric_threshold";

export type ProcessSignal = "SIGTERM" | "SIGKILL" | "SIGSTOP" | "SIGCONT" | "SIGHUP" | "SIGINT";

export type DiskFillStrategy = "zero_fill" | "random_fill" | "file_flood";

export interface NetworkLatencyFault {
  readonly kind: "network_latency";
  readonly id: string;
  readonly delayMs: number;
  readonly jitterMs?: number;
  readonly targetHost?: string;
  readonly correlationPercent?: number;
  readonly durationMs: number;
}

export interface PacketDropFault {
  readonly kind: "packet_drop";
  readonly id: string;
  readonly dropPercentage: number;
  readonly targetPort?: number;
  readonly targetHost?: string;
  readonly durationMs: number;
}

export interface ProcessKillFault {
  readonly kind: "process_kill";
  readonly id: string;
  readonly signal: ProcessSignal;
  readonly targetProcessName?: string;
  readonly pid?: number;
  readonly restartAfterMs?: number;
  readonly durationMs?: number;
}

export interface DiskPressureFault {
  readonly kind: "disk_pressure";
  readonly id: string;
  readonly fillBytesMb: number;
  readonly targetPath: string;
  readonly fillStrategy: DiskFillStrategy;
  readonly durationMs: number;
}

export interface CpuThrottleFault {
  readonly kind: "cpu_throttle";
  readonly id: string;
  readonly cpuQuotaPercent: number;
  readonly coresToStress?: number;
  readonly durationMs: number;
}

export interface OomSimulationFault {
  readonly kind: "oom_simulation";
  readonly id: string;
  readonly memoryBalloonMb: number;
  readonly durationMs: number;
  readonly triggerSwapThrashed?: boolean;
}

export interface NetworkBlackholeFault {
  readonly kind: "network_blackhole";
  readonly id: string;
  readonly blockedHosts?: readonly string[];
  readonly blockedPorts?: readonly number[];
  readonly durationMs: number;
}

export interface IoThrottleFault {
  readonly kind: "io_throttle";
  readonly id: string;
  readonly readRateLimitKbps?: number;
  readonly writeRateLimitKbps?: number;
  readonly targetPath?: string;
  readonly durationMs: number;
}

export type ChaosFault =
  | NetworkLatencyFault
  | PacketDropFault
  | ProcessKillFault
  | DiskPressureFault
  | CpuThrottleFault
  | OomSimulationFault
  | NetworkBlackholeFault
  | IoThrottleFault;

export interface ChaosTrigger {
  readonly type: ChaosTriggerType;
  readonly delayMsAfterTrigger?: number;
  readonly turnIndex?: number;
  readonly toolName?: string;
  readonly metricName?: string;
  readonly metricThreshold?: number;
}

export interface ChaosScheduleItem {
  readonly id: string;
  readonly name: string;
  readonly severity: ChaosFaultSeverity;
  readonly fault: ChaosFault;
  readonly trigger: ChaosTrigger;
  readonly rollbackRequired: boolean;
  readonly maxRetries?: number;
}

export interface ChaosSchedule {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly items: readonly ChaosScheduleItem[];
  readonly autoRestoreOnFailure: boolean;
  readonly globalTimeoutMs?: number;
}

export interface ChaosPerturbationMatrix {
  readonly name: string;
  readonly description?: string;
  readonly scenarios: readonly string[];
  readonly schedules: readonly ChaosSchedule[];
  readonly repetitions: number;
  readonly seed?: number;
}

export interface ChaosExperimentTimelineEvent {
  readonly timestamp: string;
  readonly elapsedMs: number;
  readonly phase: "baseline" | "injection" | "active_fault" | "recovery" | "post_check";
  readonly eventType: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface ChaosFaultExecutionResult {
  readonly scheduleItemId: string;
  readonly faultKind: FaultInjectionKind;
  readonly status: ChaosFaultStatus;
  readonly injectedAt: string;
  readonly restoredAt?: string;
  readonly durationMs: number;
  readonly errorMessage?: string;
  readonly metricsBefore?: Readonly<Record<string, number>>;
  readonly metricsDuring?: Readonly<Record<string, number>>;
  readonly metricsAfter?: Readonly<Record<string, number>>;
}

export interface ChaosExperimentReport {
  readonly experimentId: string;
  readonly scenarioId: string;
  readonly runId: string;
  readonly schedule: ChaosSchedule;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly faultResults: readonly ChaosFaultExecutionResult[];
  readonly timeline: readonly ChaosExperimentTimelineEvent[];
  readonly violations: readonly string[];
}

export interface ChaosExecutionContext {
  readonly experimentId: string;
  readonly scenarioId: string;
  readonly activeFaults: readonly ChaosFault[];
  readonly elapsedMs: number;
  readonly notifyTurnStart: (turnIndex: number) => Promise<void>;
  readonly notifyTurnEnd: (turnIndex: number) => Promise<void>;
  readonly notifyBeforeToolCall: (toolName: string) => Promise<void>;
  readonly notifyAfterToolCall: (toolName: string) => Promise<void>;
}

export interface IFaultInjector {
  inject(fault: ChaosFault): Promise<ChaosFaultExecutionResult>;
  restore(faultId: string): Promise<boolean>;
  restoreAll(): Promise<void>;
  getActiveFaults(): readonly ChaosFaultExecutionResult[];
}

export interface ChaosEngineConfig {
  readonly autoRollbackOnExit: boolean;
  readonly maxConcurrentFaults: number;
  readonly safetyTimeoutMs: number;
  readonly abortOnCatastrophicFailure: boolean;
  readonly seed?: number;
}

export interface IChaosEngine {
  readonly config: ChaosEngineConfig;
  executeExperiment<T>(
    scenarioId: string,
    schedule: ChaosSchedule,
    scenarioRunner: (context: ChaosExecutionContext) => Promise<T>,
  ): Promise<{ readonly result: T; readonly report: ChaosExperimentReport }>;
  executeMatrix<T>(
    matrix: ChaosPerturbationMatrix,
    scenarioRunner: (
      scenarioId: string,
      schedule: ChaosSchedule,
      context: ChaosExecutionContext,
    ) => Promise<T>,
  ): Promise<readonly ChaosExperimentReport[]>;
}

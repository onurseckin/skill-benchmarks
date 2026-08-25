import type {
  LLMProviderAdapter,
  ExecutionLimits,
  ScenarioResult,
  AgentMessage,
  TokenUsage,
  DetailedTokenTelemetry,
  RunTerminationReason,
} from "../runner/types.js";
import type {
  IContainerPoolManager,
} from "../infrastructure/container/types.js";
import type {
  RunRecord,
} from "../reporting/types.js";
import type {
  BenchmarkRuntimeConfig,
} from "../shared/benchmark-runtime-config.js";
import type {
  ExecutionMode,
} from "../shared/execution-mode.js";

export type SweepExecutionStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "aborted";

export type CellStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "retrying";

export interface RateLimitConfig {
  readonly maxRequestsPerMinute: number;
  readonly maxTokensPerMinute: number;
  readonly maxConcurrentRequests?: number;
  readonly refillIntervalMs?: number;
  readonly initialTokensRatio?: number;
  readonly backoffBaseMs?: number;
  readonly backoffMaxMs?: number;
  readonly backoffFactor?: number;
  readonly jitter?: boolean;
}

export interface ProviderRateLimitPolicy {
  readonly providerId: string;
  readonly defaultRateLimit: RateLimitConfig;
  readonly modelOverrides?: Readonly<Record<string, Partial<RateLimitConfig>>>;
}

export interface ConcurrencyControls {
  readonly maxGlobalConcurrency: number;
  readonly maxPerModelConcurrency?: number;
  readonly maxPerProviderConcurrency?: number;
  readonly maxPerScenarioConcurrency?: number;
  readonly containerAcquisitionTimeoutMs?: number;
  readonly queuePollIntervalMs?: number;
}

export interface ModelMatrixEntry {
  readonly modelId: string;
  readonly providerId: string;
  readonly provider?: LLMProviderAdapter;
  readonly displayName?: string;
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxTokens?: number;
  readonly thinkingLevel?: "none" | "low" | "medium" | "high" | "max";
  readonly thinkingBudget?: number;
  readonly reasoningEffort?: "low" | "medium" | "high";
  readonly concurrencyLimit?: number;
  readonly rateLimit?: RateLimitConfig;
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MatrixCellIdentifier {
  readonly cellId: string;
  readonly scenarioId: string;
  readonly skillId: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly thinkingLevel?: "none" | "low" | "medium" | "high" | "max";
  readonly thinkingBudget?: number;
  readonly repetitionIndex: number;
}

export interface MatrixCellDescriptor extends MatrixCellIdentifier {
  readonly runId: string;
  readonly executionMode: ExecutionMode;
  readonly outputRoot: string;
  readonly modelEntry: ModelMatrixEntry;
  readonly limits: ExecutionLimits;
  readonly temperature?: number;
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MatrixCellResult {
  readonly cell: MatrixCellDescriptor;
  readonly status: CellStatus;
  readonly attemptCount: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly durationMs: number;
  readonly scenarioResult?: ScenarioResult;
  readonly runRecord?: RunRecord;
  readonly error?: string;
  readonly retryable: boolean;
}

export interface SweepProgress {
  readonly sweepId: string;
  readonly totalCells: number;
  readonly completedCells: number;
  readonly failedCells: number;
  readonly skippedCells: number;
  readonly inFlightCells: number;
  readonly queuedCells: number;
  readonly percentage: number;
  readonly elapsedMs: number;
  readonly estimatedRemainingMs: number;
  readonly totalTokensConsumed: number;
  readonly totalCostUSD: number;
  readonly averageCellDurationMs: number;
}

export type SweepEventType =
  | "sweep:init"
  | "sweep:start"
  | "sweep:pause"
  | "sweep:resume"
  | "sweep:complete"
  | "sweep:abort"
  | "cell:queued"
  | "cell:start"
  | "cell:progress"
  | "cell:complete"
  | "cell:error"
  | "cell:retry"
  | "cell:skip"
  | "rate_limit:throttle"
  | "rate_limit:recover"
  | "checkpoint:saved"
  | "checkpoint:restored";

export interface SweepEvent {
  readonly type: SweepEventType;
  readonly sweepId: string;
  readonly timestamp: string;
  readonly cellId?: string;
  readonly message: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly progress?: SweepProgress;
}

export type SweepEventListener = (event: SweepEvent) => void | Promise<void>;

export interface CheckpointConfig {
  readonly enabled: boolean;
  readonly filePath: string;
  readonly saveIntervalMs?: number;
  readonly saveOnCellCompletion?: boolean;
  readonly maxBackups?: number;
  readonly autoResume?: boolean;
}

export interface CheckpointMetadata {
  readonly version: string;
  readonly sweepId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly hostArch: string;
  readonly bunVersion: string;
}

export interface CheckpointState {
  readonly metadata: CheckpointMetadata;
  readonly status: SweepExecutionStatus;
  readonly totalPlannedCells: number;
  readonly completedCellIds: readonly string[];
  readonly failedCellIds: readonly string[];
  readonly skippedCellIds: readonly string[];
  readonly completedResults: Readonly<Record<string, MatrixCellResult>>;
  readonly totalTokens: TokenUsage;
  readonly totalCostUSD: number;
  readonly wallClockDurationMs: number;
  readonly configSummary: {
    readonly scenarioIds: readonly string[];
    readonly skillIds: readonly string[];
    readonly modelIds: readonly string[];
    readonly repetitions: number;
  };
}

export interface MatrixSweepConfig {
  readonly runtimeConfig: BenchmarkRuntimeConfig;
  readonly sweepId?: string;
  readonly scenarioIds: readonly string[];
  readonly skillIds: readonly string[];
  readonly models: readonly ModelMatrixEntry[];
  readonly thinkingLevels?: readonly ("none" | "low" | "medium" | "high" | "max")[];
  readonly repetitions?: number;
  readonly concurrency?: Partial<ConcurrencyControls>;
  readonly rateLimits?: readonly ProviderRateLimitPolicy[];
  readonly defaultExecutionLimits?: Partial<ExecutionLimits>;
  readonly workspaceRoot?: string;
  readonly containerPool?: IContainerPoolManager;
  readonly checkpoint?: Partial<CheckpointConfig>;
  readonly telemetryDbPath?: string;
  readonly dryRun?: boolean;
  readonly maxRetriesPerCell?: number;
  readonly stopOnFirstFailure?: boolean;
  readonly listeners?: readonly SweepEventListener[];
}

export interface MatrixSweepSummary {
  readonly sweepId: string;
  readonly status: SweepExecutionStatus;
  readonly totalCells: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly totalDurationMs: number;
  readonly totalCostUSD: number;
  readonly totalTokens: TokenUsage;
  readonly detailedTokens: DetailedTokenTelemetry;
  readonly results: readonly MatrixCellResult[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly error?: string;
}

export interface ITokenBucketRateLimiter {
  readonly providerId: string;
  readonly modelId?: string;
  acquire(estimatedTokens: number, signal?: AbortSignal): Promise<void>;
  recordConsumption(actualTokens: number): void;
  reportRateLimitViolation(retryAfterMs?: number): Promise<void>;
  getStatus(): {
    readonly availableTokens: number;
    readonly availableRequests: number;
    readonly isThrottled: boolean;
    readonly queueDepth: number;
  };
}

export interface ICheckpointLedger {
  readonly filePath: string;
  load(): Promise<CheckpointState | null>;
  save(state: CheckpointState): Promise<void>;
  recordCellSuccess(result: MatrixCellResult): Promise<void>;
  recordCellFailure(result: MatrixCellResult): Promise<void>;
  isCellCompleted(cellId: string): boolean;
  getCompletedResults(): readonly MatrixCellResult[];
  getState(): CheckpointState;
}

export interface IMatrixSweepEngine {
  readonly sweepId: string;
  readonly status: SweepExecutionStatus;
  run(config: MatrixSweepConfig): Promise<MatrixSweepSummary>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  abort(reason?: string): Promise<void>;
  getProgress(): SweepProgress;
  on(listener: SweepEventListener): () => void;
}

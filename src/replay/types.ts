import type { TelemetryEvent } from "../infrastructure/telemetry/types.js";
import type { ExecutionMode } from "../shared/execution-mode.js";
import type {
  BenchmarkCohort,
  BenchmarkEligibilityStatus,
  EvaluationOutcomeStatus,
} from "../shared/benchmark-authority.js";

export const replaySessionSchemaVersion = "1.0.0" as const;

export type ReplayFrameType =
  | "session_start"
  | "turn_start"
  | "turn_end"
  | "tool_call"
  | "tool_result"
  | "command_start"
  | "command_stream"
  | "command_end"
  | "resource_sample"
  | "git_diff"
  | "session_end"
  | "error"
  | "generic";

export type ReplayExecutionStatus = "completed" | "failed" | "timed_out" | "aborted";
export type ReplayStream = "stdout" | "stderr";

export interface ToolCallEvent {
  readonly toolName: string;
  readonly callId: string;
  readonly inputPayload?: Readonly<Record<string, unknown>>;
  readonly timestampUs: string;
  readonly durationMs?: number;
  readonly exitCode?: number;
  readonly isError?: boolean;
}

export interface CommandEvent {
  readonly commandId: string;
  readonly stream?: ReplayStream;
  readonly chunk?: string;
  readonly durationMs?: number;
  readonly exitCode?: number;
  readonly outputTruncated?: boolean;
}

export interface ThinkingEvent {
  readonly thoughtChunk: string;
  readonly tokenCount: number;
  readonly timestampUs: string;
}

export type DiffChangeType = "added" | "modified" | "deleted" | "renamed";

export interface DiffDelta {
  readonly path: string;
  readonly changeType: DiffChangeType;
  readonly insertions: number;
  readonly deletions: number;
  readonly diffHunk?: string;
  readonly isBinary?: boolean;
}

export interface CgroupTelemetryPoint {
  readonly timestampMs: number;
  readonly cpuPercent: number;
  readonly memoryRssMb: number;
  readonly memoryLimitMb: number;
  readonly memoryPercent: number;
  readonly diskReadKb: number;
  readonly diskWriteKb: number;
  readonly networkRxKb: number;
  readonly networkTxKb: number;
  readonly activePids: number;
}

export interface TrajectoryFrame {
  readonly frameIndex: number;
  readonly sequenceNumber: number;
  readonly timestampUs: string;
  readonly sourceEventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly eventType: ReplayFrameType;
  readonly summary: string;
  readonly elapsedUs: string;
  readonly elapsedMs: number;
  readonly turnIndex?: number;
  readonly toolCall?: ToolCallEvent;
  readonly command?: CommandEvent;
  readonly thinking?: ThinkingEvent;
  readonly diff?: DiffDelta;
  readonly telemetry?: CgroupTelemetryPoint;
  readonly totalTokens?: number;
  readonly totalCostUSD?: number;
}

export interface ReplaySessionMetadata {
  readonly runId: string;
  readonly scenarioId: string;
  readonly skillIds: readonly string[];
  readonly modelId: string;
  readonly providerId?: string;
  readonly executionMode?: ExecutionMode;
  readonly simulated?: boolean;
  readonly startTimestampUs: string;
  readonly endTimestampUs: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly durationMs: number;
  readonly executionStatus: ReplayExecutionStatus;
  readonly terminationReason: string;
  readonly totalTurns: number;
  readonly totalToolCalls: number;
  readonly totalTokens?: number;
  readonly totalCostUSD?: number;
}

export interface ReplayProvenance {
  readonly source: "persisted-events";
  readonly sourceKind: "direct" | "canonical-run";
  readonly sweepId?: string;
  readonly cellId?: string;
  readonly planFingerprint?: string;
  readonly benchmarkCohort?: BenchmarkCohort;
  readonly eligibilityStatus?: BenchmarkEligibilityStatus;
  readonly eligibilityReasons?: readonly string[];
  readonly evaluationStatus?: EvaluationOutcomeStatus;
}

export interface ReplaySession {
  readonly schemaVersion: typeof replaySessionSchemaVersion;
  readonly provenance: ReplayProvenance;
  readonly metadata: ReplaySessionMetadata;
  readonly frames: readonly TrajectoryFrame[];
  readonly telemetrySeries: readonly CgroupTelemetryPoint[];
  readonly diffs: readonly DiffDelta[];
  readonly sourceEvents: readonly TelemetryEvent[];
}

export interface ReplayEvidenceIdentity {
  readonly sourceKind?: "direct" | "canonical-run";
  readonly runId?: string;
  readonly sweepId?: string;
  readonly cellId?: string;
  readonly planFingerprint?: string;
  readonly matrixOccurrenceIndex?: number;
  readonly scenarioId?: string;
  readonly category?: string;
  readonly skillId?: string;
  readonly modelId?: string;
  readonly providerId?: string;
  readonly executionMode?: ExecutionMode;
  readonly simulated?: boolean;
  readonly dryRun?: boolean;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly status?: ReplayExecutionStatus;
  readonly terminationReason?: string;
  readonly durationMs?: number;
  readonly totalCostUSD?: number;
  readonly totalTurns?: number;
  readonly totalTokens?: number;
  readonly benchmarkCohort?: BenchmarkCohort;
  readonly eligibilityStatus?: BenchmarkEligibilityStatus;
  readonly eligibilityReasons?: readonly string[];
  readonly evaluationStatus?: EvaluationOutcomeStatus;
}

export interface ReplayEvidenceSource {
  readonly eventsPath: string;
  readonly expectedRunId?: string;
  readonly manifestPath?: string;
  readonly resultPath?: string;
  readonly expectedIdentity?: ReplayEvidenceIdentity;
}

export interface TuiPlayerOptions {
  readonly playbackSpeed?: number;
  readonly autoPlay?: boolean;
  readonly loop?: boolean;
  readonly interactive?: boolean;
  readonly theme?: "dark" | "light" | "terminal";
  readonly showTelemetry?: boolean;
  readonly showDiffs?: boolean;
  readonly showThinking?: boolean;
  readonly initialFrame?: number;
  readonly filterEventType?: readonly ReplayFrameType[];
}

export interface WebPlayerOptions {
  readonly title?: string;
  readonly autoPlay?: boolean;
  readonly theme?: "dark" | "light";
  readonly embedData?: boolean;
  readonly outputPath?: string;
  readonly includeTelemetryCharts?: boolean;
  readonly playbackSpeed?: number;
}

export interface ReplaySummary {
  readonly frameCount: number;
  readonly turnCount: number;
  readonly toolCallCount: number;
  readonly peakCpuPercent?: number;
  readonly peakMemoryMb?: number;
  readonly totalInsertions: number;
  readonly totalDeletions: number;
  readonly executionStatus: ReplayExecutionStatus;
}

export type PlayerTab = "overview" | "tool" | "thinking" | "diff" | "telemetry";

export interface ReplayPlayerState {
  readonly currentFrameIndex: number;
  readonly totalFrames: number;
  readonly isPlaying: boolean;
  readonly speed: number;
  readonly selectedTab: PlayerTab;
  readonly filterQuery?: string;
}

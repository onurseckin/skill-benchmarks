export type ReplayFrameType =
  | "session_start"
  | "turn_start"
  | "model_thinking"
  | "tool_call"
  | "tool_output"
  | "cgroup_sample"
  | "git_diff"
  | "turn_end"
  | "session_end"
  | "error";

export type ReplaySessionStatus = "completed" | "failed" | "timed_out" | "aborted";

export interface ToolCallEvent {
  readonly toolName: string;
  readonly callId: string;
  readonly inputPayload: Readonly<Record<string, unknown>>;
  readonly timestampUs: string;
  readonly durationMs?: number;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error?: string;
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
  readonly timestampMs: number;
  readonly eventType: ReplayFrameType;
  readonly turnIndex: number;
  readonly summary: string;
  readonly elapsedMs: number;
  readonly toolCall?: ToolCallEvent;
  readonly thinking?: ThinkingEvent;
  readonly diff?: DiffDelta;
  readonly telemetry?: CgroupTelemetryPoint;
  readonly totalTokens?: number;
  readonly totalCostUSD?: number;
}

export interface ReplaySessionMetadata {
  readonly sessionId: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly scenarioName?: string;
  readonly skillId: string;
  readonly skillVersion?: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly startTime: string;
  readonly endTime?: string;
  readonly durationMs: number;
  readonly status: ReplaySessionStatus;
  readonly totalTurns: number;
  readonly totalToolCalls: number;
  readonly totalTokens: number;
  readonly totalCostUSD: number;
  readonly score?: number;
  readonly exitCode?: number;
  readonly errorMessage?: string;
}

export interface ReplaySession {
  readonly metadata: ReplaySessionMetadata;
  readonly frames: readonly TrajectoryFrame[];
  readonly telemetrySeries: readonly CgroupTelemetryPoint[];
  readonly diffs: readonly DiffDelta[];
  readonly rawEvents?: readonly Readonly<Record<string, unknown>>[];
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
  readonly peakCpuPercent: number;
  readonly peakMemoryMb: number;
  readonly totalInsertions: number;
  readonly totalDeletions: number;
  readonly verdict: string;
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

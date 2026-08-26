export type CanvasColorMode = "16-color" | "256-color" | "truecolor" | "monochrome" | "ascii";

export type FrameCompressionFormat = "raw" | "ansi-delta" | "run-length" | "json-diff";

export type StreamingProtocol = "websocket" | "sse" | "raw-tcp" | "http-chunked";

export type StreamingConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error";

export type TelemetryChunkType =
  | "metrics"
  | "log"
  | "state"
  | "chart"
  | "hud"
  | "alert"
  | "heartbeat"
  | "custom";

export type HudPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top-center"
  | "bottom-center";

export type HudBadgeStyle = "pill" | "square" | "bordered";

export interface CanvasDimensions {
  readonly cols: number;
  readonly rows: number;
  readonly widthPx?: number;
  readonly heightPx?: number;
}

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export type AnsiColorValue = string | number | RgbColor;

export interface AnsiStyle {
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly blink?: boolean;
  readonly inverse?: boolean;
  readonly hidden?: boolean;
  readonly strikethrough?: boolean;
  readonly foregroundColor?: AnsiColorValue;
  readonly backgroundColor?: AnsiColorValue;
}

export interface CanvasCell {
  readonly char: string;
  readonly style: AnsiStyle;
  readonly dirty?: boolean;
}

export interface CanvasGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly (readonly CanvasCell[])[];
}

export interface CanvasViewportConfig {
  readonly cols: number;
  readonly rows: number;
  readonly fps?: number;
  readonly colorMode?: CanvasColorMode;
  readonly cellWidth?: number;
  readonly cellHeight?: number;
  readonly tabSize?: number;
  readonly autoResize?: boolean;
  readonly clearOnStart?: boolean;
  readonly alternateScreen?: boolean;
}

export interface FrameStats {
  readonly renderDurationMs: number;
  readonly compressionRatio: number;
  readonly dirtyCellCount: number;
  readonly totalBytes: number;
}

export interface CanvasFrame {
  readonly frameId: number;
  readonly timestamp: number;
  readonly sequence: number;
  readonly cols: number;
  readonly rows: number;
  readonly format: FrameCompressionFormat;
  readonly data: string | Uint8Array;
  readonly isKeyframe: boolean;
  readonly checksum: string;
  readonly stats?: FrameStats;
}

export interface CellDelta {
  readonly x: number;
  readonly y: number;
  readonly char: string;
  readonly style?: AnsiStyle;
}

export interface FrameDelta {
  readonly frameId: number;
  readonly previousFrameId: number;
  readonly timestamp: number;
  readonly changedCells: readonly CellDelta[];
}

export interface TelemetryChunk {
  readonly chunkId: string;
  readonly channel: string;
  readonly type: TelemetryChunkType;
  readonly timestamp: number;
  readonly sequence: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sourceId?: string;
}

export interface ContainerTelemetrySnapshot {
  readonly containerId: string;
  readonly timestamp: number;
  readonly cpuPercent: number;
  readonly memoryUsageBytes: number;
  readonly memoryLimitBytes: number;
  readonly networkRxBytes: number;
  readonly networkTxBytes: number;
  readonly activeProcessCount: number;
  readonly status: string;
}

export interface LeaderboardEntryItem {
  readonly skillId: string;
  readonly rank: number;
  readonly elo: number;
  readonly winRate: number;
  readonly meanScore: number;
}

export interface LeaderboardLiveSnapshot {
  readonly timestamp: number;
  readonly totalRuns: number;
  readonly activeRuns: number;
  readonly topSkills: readonly LeaderboardEntryItem[];
}

export interface StreamingConnectionOptions {
  readonly host?: string;
  readonly port?: number;
  readonly path?: string;
  readonly ssl?: boolean;
  readonly protocol?: StreamingProtocol;
  readonly maxPayloadBytes?: number;
  readonly heartbeatIntervalMs?: number;
  readonly reconnectTimeoutMs?: number;
  readonly maxReconnectAttempts?: number;
  readonly bufferSize?: number;
  readonly compression?: FrameCompressionFormat;
}

export interface ClientSubscriptionMessage {
  readonly type: "subscribe" | "unsubscribe" | "resize" | "ping" | "config";
  readonly channel: string;
  readonly clientId?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface ServerBroadcastMessage {
  readonly type: "frame" | "telemetry" | "event" | "stats" | "pong" | "error" | "ack";
  readonly channel: string;
  readonly timestamp: number;
  readonly sequence: number;
  readonly data: unknown;
}

export interface BroadcastSubscriber {
  readonly id: string;
  readonly channel: string;
  readonly connectedAt: number;
  readonly lastPingAt: number;
  readonly isAlive: boolean;
  readonly send: (message: ServerBroadcastMessage | string | Uint8Array) => void;
  readonly close: () => void;
}

export interface HudBadge {
  readonly label: string;
  readonly value: string;
  readonly color?: string;
  readonly style?: HudBadgeStyle;
}

export interface HudOverlayConfig {
  readonly enabled: boolean;
  readonly showFps?: boolean;
  readonly showLatency?: boolean;
  readonly showResourceUsage?: boolean;
  readonly showTimestamp?: boolean;
  readonly showContainerId?: boolean;
  readonly showTitle?: boolean;
  readonly title?: string;
  readonly position?: HudPosition;
  readonly theme?: string;
  readonly customBadges?: readonly HudBadge[];
}

export interface HudSnapshot {
  readonly fps: number;
  readonly latencyMs: number;
  readonly cpuUsage: number;
  readonly memoryUsageMb: number;
  readonly activeContainerId?: string;
  readonly timestamp: string;
  readonly badges: readonly HudBadge[];
}

export interface SparklineChartModel {
  readonly title: string;
  readonly dataPoints: readonly number[];
  readonly min?: number;
  readonly max?: number;
  readonly width: number;
  readonly color?: string;
  readonly sparkChars?: readonly string[];
}

export interface BarChartModel {
  readonly title: string;
  readonly categories: readonly string[];
  readonly values: readonly number[];
  readonly maxValue?: number;
  readonly width: number;
  readonly color?: string;
}

export interface HistogramBin {
  readonly label: string;
  readonly count: number;
}

export interface HistogramChartModel {
  readonly title: string;
  readonly bins: readonly HistogramBin[];
  readonly width: number;
}

export interface CanvasStreamerOptions {
  readonly viewport?: Partial<CanvasViewportConfig>;
  readonly hud?: Partial<HudOverlayConfig>;
  readonly compression?: FrameCompressionFormat;
  readonly targetFps?: number;
  readonly onFrame?: (frame: CanvasFrame) => void;
  readonly onError?: (error: Error) => void;
  readonly onResize?: (dimensions: CanvasDimensions) => void;
}

export interface BroadcasterMetrics {
  readonly totalClients: number;
  readonly totalChannels: number;
  readonly totalFramesSent: number;
  readonly totalBytesBroadcast: number;
  readonly uptimeSeconds: number;
  readonly droppedFrames: number;
}

export interface BroadcasterOptions {
  readonly heartbeatIntervalMs?: number;
  readonly clientTimeoutMs?: number;
  readonly maxBufferSize?: number;
  readonly enableCompression?: boolean;
  readonly onClientConnect?: (subscriber: BroadcastSubscriber) => void;
  readonly onClientDisconnect?: (subscriber: BroadcastSubscriber) => void;
  readonly onError?: (error: Error) => void;
}

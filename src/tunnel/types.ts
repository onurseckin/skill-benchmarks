export type StreamChannel =
  | "stdin"
  | "stdout"
  | "stderr"
  | "resize"
  | "ping"
  | "pong"
  | "control"
  | "error"
  | "exit"
  | "attach"
  | "detach"
  | "scrollback_request"
  | "scrollback_replay";

export type StreamChannelCode = 0x01 | 0x02 | 0x03 | 0x04 | 0x05 | 0x06 | 0x07 | 0x08 | 0x09 | 0x0a | 0x0b | 0x0c | 0x0d;

export const CHANNEL_TO_CODE: Readonly<Record<StreamChannel, StreamChannelCode>> = {
  stdin: 0x01,
  stdout: 0x02,
  stderr: 0x03,
  resize: 0x04,
  ping: 0x05,
  pong: 0x06,
  control: 0x07,
  error: 0x08,
  exit: 0x09,
  attach: 0x0a,
  detach: 0x0b,
  scrollback_request: 0x0c,
  scrollback_replay: 0x0d,
};

export const CODE_TO_CHANNEL: Readonly<Record<StreamChannelCode, StreamChannel>> = {
  0x01: "stdin",
  0x02: "stdout",
  0x03: "stderr",
  0x04: "resize",
  0x05: "ping",
  0x06: "pong",
  0x07: "control",
  0x08: "error",
  0x09: "exit",
  0x0a: "attach",
  0x0b: "detach",
  0x0c: "scrollback_request",
  0x0d: "scrollback_replay",
};

export const FRAME_HEADER_MAGIC = 0x5354;
export const FRAME_HEADER_VERSION = 0x01;
export const FRAME_HEADER_LENGTH = 16;

export interface BinaryFrameEnvelope {
  readonly magic: number;
  readonly version: number;
  readonly channel: StreamChannel;
  readonly channelCode: StreamChannelCode;
  readonly sequence: number;
  readonly timestamp: number;
  readonly payloadLength: number;
  readonly payload: Uint8Array;
}

export type ControlSignalType = "sigint" | "sigterm" | "sigkill" | "pause" | "resume" | "reset" | "eof";

export interface TerminalDimensions {
  readonly cols: number;
  readonly rows: number;
  readonly widthPx?: number;
  readonly heightPx?: number;
}

export interface StdinPacket {
  readonly channel: "stdin";
  readonly sessionId: string;
  readonly data: string | Uint8Array;
  readonly sequence?: number;
  readonly timestamp?: number;
}

export interface StdoutPacket {
  readonly channel: "stdout";
  readonly sessionId: string;
  readonly data: string | Uint8Array;
  readonly sequence?: number;
  readonly timestamp?: number;
}

export interface StderrPacket {
  readonly channel: "stderr";
  readonly sessionId: string;
  readonly data: string | Uint8Array;
  readonly sequence?: number;
  readonly timestamp?: number;
}

export interface ResizePacket {
  readonly channel: "resize";
  readonly sessionId: string;
  readonly dimensions: TerminalDimensions;
  readonly sequence?: number;
  readonly timestamp?: number;
}

export interface PingPacket {
  readonly channel: "ping";
  readonly sessionId?: string;
  readonly clientTimestamp: number;
  readonly sequence?: number;
}

export interface PongPacket {
  readonly channel: "pong";
  readonly sessionId?: string;
  readonly clientTimestamp: number;
  readonly serverTimestamp: number;
  readonly sequence?: number;
}

export interface ControlPacket {
  readonly channel: "control";
  readonly sessionId: string;
  readonly signal: ControlSignalType;
  readonly payload?: string;
  readonly sequence?: number;
  readonly timestamp?: number;
}

export interface ErrorPacket {
  readonly channel: "error";
  readonly sessionId?: string;
  readonly code: string;
  readonly message: string;
  readonly sequence?: number;
  readonly timestamp?: number;
}

export interface ExitPacket {
  readonly channel: "exit";
  readonly sessionId: string;
  readonly exitCode: number;
  readonly sequence?: number;
  readonly timestamp?: number;
}

export interface AttachPacket {
  readonly channel: "attach";
  readonly sessionId: string;
  readonly role?: TunnelClientRole;
  readonly authKey?: string;
  readonly requestScrollback?: boolean;
}

export interface DetachPacket {
  readonly channel: "detach";
  readonly sessionId: string;
  readonly reason?: string;
}

export interface ScrollbackRequestPacket {
  readonly channel: "scrollback_request";
  readonly sessionId: string;
  readonly maxLines?: number;
  readonly maxBytes?: number;
}

export interface ScrollbackReplayPacket {
  readonly channel: "scrollback_replay";
  readonly sessionId: string;
  readonly lines: readonly string[];
  readonly totalLines: number;
  readonly totalBytes: number;
}

export type StreamPacket =
  | StdinPacket
  | StdoutPacket
  | StderrPacket
  | ResizePacket
  | PingPacket
  | PongPacket
  | ControlPacket
  | ErrorPacket
  | ExitPacket
  | AttachPacket
  | DetachPacket
  | ScrollbackRequestPacket
  | ScrollbackReplayPacket;

export type MultiplexerSessionStatus =
  | "INITIALIZING"
  | "ATTACHED"
  | "STREAMING"
  | "PAUSED"
  | "DETACHED"
  | "TERMINATED"
  | "ERROR";

export interface PtySessionConfig {
  readonly sessionId: string;
  readonly containerId: string;
  readonly runId?: string;
  readonly agentId?: string;
  readonly scenarioId?: string;
  readonly initialDimensions?: TerminalDimensions;
  readonly ringBufferCapacityBytes?: number;
  readonly ringBufferCapacityLines?: number;
  readonly rateLimitBytesPerSec?: number;
  readonly throttleIntervalMs?: number;
  readonly customEnvironment?: Readonly<Record<string, string>>;
}

export interface PtySessionState {
  readonly sessionId: string;
  readonly containerId: string;
  readonly runId?: string;
  readonly agentId?: string;
  readonly scenarioId?: string;
  readonly status: MultiplexerSessionStatus;
  readonly dimensions: TerminalDimensions;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastActivityAt: string;
  readonly totalBytesSent: number;
  readonly totalBytesReceived: number;
  readonly totalChunks: number;
  readonly clientCount: number;
  readonly exitCode?: number;
  readonly error?: string;
}

export interface PtySessionStats {
  readonly sessionId: string;
  readonly status: MultiplexerSessionStatus;
  readonly uptimeMs: number;
  readonly bytesIn: number;
  readonly bytesOut: number;
  readonly totalLines: number;
  readonly droppedChunks: number;
  readonly activeClients: number;
  readonly ringBufferMemoryBytes: number;
}

export type DroppedChunkPolicy = "drop_oldest" | "drop_newest" | "reject";

export interface RingBufferOptions {
  readonly maxCapacityBytes?: number;
  readonly maxCapacityLines?: number;
  readonly dropPolicy?: DroppedChunkPolicy;
}

export interface RingBufferEntry {
  readonly sequence: number;
  readonly channel: StreamChannel;
  readonly data: Uint8Array;
  readonly text: string;
  readonly timestamp: number;
}

export interface BackpressureOptions {
  readonly rateLimitBytesPerSec?: number;
  readonly highWaterMark?: number;
  readonly lowWaterMark?: number;
  readonly throttleIntervalMs?: number;
  readonly maxQueueLength?: number;
}

export interface AnsiSequenceMatch {
  readonly raw: string;
  readonly command: string;
  readonly params: readonly number[];
  readonly isColor: boolean;
  readonly isCursor: boolean;
}

export type TunnelProtocol = "ws" | "sse" | "hybrid";
export type TunnelClientRole = "readonly" | "interactive" | "admin";
export type TunnelConnectionState = "connecting" | "open" | "closing" | "closed";

export interface TunnelClientSession {
  readonly clientId: string;
  readonly sessionId: string;
  readonly role: TunnelClientRole;
  readonly connectionState: TunnelConnectionState;
  readonly connectedAt: string;
  readonly lastPingAt: string;
  readonly protocol: "websocket" | "sse";
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface TunnelServerOptions {
  readonly port?: number;
  readonly hostname?: string;
  readonly maxClients?: number;
  readonly heartbeatIntervalMs?: number;
  readonly pingTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly authTokens?: readonly string[];
  readonly corsOrigin?: string | boolean;
  readonly enableSse?: boolean;
  readonly enableBinaryFraming?: boolean;
  readonly ringBufferBytes?: number;
  readonly ringBufferLines?: number;
  readonly rateLimitBytesPerSec?: number;
  readonly quiet?: boolean;
}

export interface TunnelServerState {
  readonly port: number;
  readonly hostname: string;
  readonly isRunning: boolean;
  readonly activeWebSockets: number;
  readonly activeSseStreams: number;
  readonly totalSessions: number;
  readonly startedAt: string;
  readonly url: string;
  readonly wsUrl: string;
  readonly totalBytesTransferred: number;
  readonly totalFramesProcessed: number;
}

export type PtyOutputListener = (data: Uint8Array, channel: "stdout" | "stderr", sequence: number) => void;
export type PtyResizeListener = (dimensions: TerminalDimensions) => void;
export type PtyExitListener = (exitCode: number) => void;
export type PtyErrorListener = (error: Error) => void;

export interface PtyMultiplexerInstance {
  createSession(config: PtySessionConfig): PtySessionState;
  getSession(sessionId: string): PtySessionState | null;
  hasSession(sessionId: string): boolean;
  listSessions(): readonly PtySessionState[];
  removeSession(sessionId: string): boolean;
  writeStdin(sessionId: string, data: Uint8Array | string): boolean;
  pushOutput(sessionId: string, data: Uint8Array | string, channel?: "stdout" | "stderr"): number;
  resizeSession(sessionId: string, dimensions: TerminalDimensions): boolean;
  pauseSession(sessionId: string): boolean;
  resumeSession(sessionId: string): boolean;
  terminateSession(sessionId: string, exitCode?: number): boolean;
  getScrollback(sessionId: string, maxLines?: number, maxBytes?: number): readonly string[];
  getStats(sessionId: string): PtySessionStats | null;
  onOutput(sessionId: string, listener: PtyOutputListener): () => void;
  onResize(sessionId: string, listener: PtyResizeListener): () => void;
  onExit(sessionId: string, listener: PtyExitListener): () => void;
  onError(sessionId: string, listener: PtyErrorListener): () => void;
  dispose(): void;
}

export interface StreamTunnelInstance {
  readonly options: TunnelServerOptions;
  readonly multiplexer: PtyMultiplexerInstance;
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): TunnelServerState;
  broadcastToSession(sessionId: string, packet: StreamPacket): number;
  broadcastBinaryToSession(sessionId: string, envelope: BinaryFrameEnvelope): number;
}

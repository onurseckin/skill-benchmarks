import { RateLimiter, RingBuffer } from "./pty-buffer.js";
export { parseAnsiSequences, RateLimiter, RingBuffer, stripAnsi } from "./pty-buffer.js";
import type {
  MultiplexerSessionStatus,
  PtyErrorListener,
  PtyExitListener,
  PtyMultiplexerInstance,
  PtyOutputListener,
  PtyResizeListener,
  PtySessionConfig,
  PtySessionState,
  PtySessionStats,
  TerminalDimensions,
} from "./types.js";

const TEXT_ENCODER = new TextEncoder();
export class PtySession {
  public readonly config: PtySessionConfig;
  private status: MultiplexerSessionStatus = "ATTACHED";
  private dims: TerminalDimensions;
  private readonly createdAtIso: string;
  private updatedAtIso: string;
  private lastActivityAtIso: string;
  private bytesSent = 0;
  private bytesRecv = 0;
  private chunkCount = 0;
  private seqCounter = 0;
  private clients = 0;
  private exitCodeNum?: number;
  private errStr?: string;
  private readonly ringBuffer: RingBuffer;
  private readonly rateLimiter: RateLimiter;
  private readonly onOutputListeners = new Set<PtyOutputListener>();
  private readonly onResizeListeners = new Set<PtyResizeListener>();
  private readonly onExitListeners = new Set<PtyExitListener>();
  private readonly onErrorListeners = new Set<PtyErrorListener>();

  public constructor(config: PtySessionConfig) {
    this.config = config;
    this.dims = config.initialDimensions ?? { cols: 80, rows: 24 };
    const now = new Date().toISOString();
    this.createdAtIso = now;
    this.updatedAtIso = now;
    this.lastActivityAtIso = now;
    this.ringBuffer = new RingBuffer({
      maxCapacityBytes: config.ringBufferCapacityBytes,
      maxCapacityLines: config.ringBufferCapacityLines,
    });
    this.rateLimiter = new RateLimiter({
      rateLimitBytesPerSec: config.rateLimitBytesPerSec,
      throttleIntervalMs: config.throttleIntervalMs,
    });
  }

  public getState(): PtySessionState {
    return {
      sessionId: this.config.sessionId,
      containerId: this.config.containerId,
      runId: this.config.runId,
      agentId: this.config.agentId,
      scenarioId: this.config.scenarioId,
      status: this.status,
      dimensions: this.dims,
      createdAt: this.createdAtIso,
      updatedAt: this.updatedAtIso,
      lastActivityAt: this.lastActivityAtIso,
      totalBytesSent: this.bytesSent,
      totalBytesReceived: this.bytesRecv,
      totalChunks: this.chunkCount,
      clientCount: this.clients,
      exitCode: this.exitCodeNum,
      error: this.errStr,
    };
  }

  public getStats(): PtySessionStats {
    return {
      sessionId: this.config.sessionId,
      status: this.status,
      uptimeMs: Math.max(0, Date.now() - new Date(this.createdAtIso).getTime()),
      bytesIn: this.bytesRecv,
      bytesOut: this.bytesSent,
      totalLines: this.ringBuffer.getEntryCount(),
      droppedChunks: this.ringBuffer.getDroppedCount(),
      activeClients: this.clients,
      ringBufferMemoryBytes: this.ringBuffer.getMemoryUsage(),
    };
  }

  public writeStdin(data: Uint8Array | string): boolean {
    if (this.status === "TERMINATED" || this.status === "ERROR") return false;
    const bytes = typeof data === "string" ? TEXT_ENCODER.encode(data) : data;
    this.bytesRecv += bytes.byteLength;
    this.lastActivityAtIso = new Date().toISOString();
    return true;
  }

  public pushOutput(data: Uint8Array | string, channel: "stdout" | "stderr" = "stdout"): number {
    if (this.status === "TERMINATED" || this.status === "ERROR") return 0;
    const bytes = typeof data === "string" ? TEXT_ENCODER.encode(data) : data;
    this.rateLimiter.consume(bytes.byteLength);
    this.seqCounter += 1;
    const seq = this.seqCounter;
    const now = Date.now();
    this.ringBuffer.push(bytes, channel, seq, now);
    this.bytesSent += bytes.byteLength;
    this.chunkCount += 1;
    this.status = "STREAMING";
    this.lastActivityAtIso = new Date(now).toISOString();
    this.updatedAtIso = this.lastActivityAtIso;
    for (const l of this.onOutputListeners) {
      try {
        l(bytes, channel, seq);
      } catch (e) {
        this.emitError(e instanceof Error ? e : new Error(String(e)));
      }
    }
    return seq;
  }

  public resize(dimensions: TerminalDimensions): boolean {
    if (this.status === "TERMINATED") return false;
    this.dims = dimensions;
    this.updatedAtIso = new Date().toISOString();
    for (const l of this.onResizeListeners) {
      try {
        l(dimensions);
      } catch (e) {
        this.emitError(e instanceof Error ? e : new Error(String(e)));
      }
    }
    return true;
  }

  public pause(): boolean {
    if (this.status === "STREAMING" || this.status === "ATTACHED") {
      this.status = "PAUSED";
      this.updatedAtIso = new Date().toISOString();
      return true;
    }
    return false;
  }

  public resume(): boolean {
    if (this.status === "PAUSED") {
      this.status = "STREAMING";
      this.updatedAtIso = new Date().toISOString();
      return true;
    }
    return false;
  }

  public terminate(exitCode = 0): boolean {
    if (this.status === "TERMINATED") return false;
    this.status = "TERMINATED";
    this.exitCodeNum = exitCode;
    this.updatedAtIso = new Date().toISOString();
    for (const l of this.onExitListeners) {
      try {
        l(exitCode);
      } catch (e) {
        this.emitError(e instanceof Error ? e : new Error(String(e)));
      }
    }
    return true;
  }

  public emitError(error: Error): void {
    this.errStr = error.message;
    this.status = "ERROR";
    this.updatedAtIso = new Date().toISOString();
    for (const l of this.onErrorListeners) l(error);
  }

  public getScrollback(maxLines?: number, maxBytes?: number): readonly string[] {
    return this.ringBuffer.getScrollback(maxLines, maxBytes);
  }

  public setClientCount(count: number): void {
    this.clients = Math.max(0, count);
  }

  public onOutput(l: PtyOutputListener): () => void {
    this.onOutputListeners.add(l);
    return () => this.onOutputListeners.delete(l);
  }

  public onResize(l: PtyResizeListener): () => void {
    this.onResizeListeners.add(l);
    return () => this.onResizeListeners.delete(l);
  }

  public onExit(l: PtyExitListener): () => void {
    this.onExitListeners.add(l);
    return () => this.onExitListeners.delete(l);
  }

  public onError(l: PtyErrorListener): () => void {
    this.onErrorListeners.add(l);
    return () => this.onErrorListeners.delete(l);
  }

  public dispose(): void {
    this.terminate(0);
    this.onOutputListeners.clear();
    this.onResizeListeners.clear();
    this.onExitListeners.clear();
    this.onErrorListeners.clear();
    this.ringBuffer.clear();
  }
}

export class PtyMultiplexer implements PtyMultiplexerInstance {
  private readonly sessions = new Map<string, PtySession>();

  public createSession(config: PtySessionConfig): PtySessionState {
    const existing = this.sessions.get(config.sessionId);
    if (existing) return existing.getState();
    const session = new PtySession(config);
    this.sessions.set(config.sessionId, session);
    return session.getState();
  }

  public getSession(sessionId: string): PtySessionState | null {
    const s = this.sessions.get(sessionId);
    return s ? s.getState() : null;
  }

  public getSessionInstance(sessionId: string): PtySession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  public hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
  public listSessions(): readonly PtySessionState[] {
    return Array.from(this.sessions.values()).map((s) => s.getState());
  }

  public removeSession(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.dispose();
    return this.sessions.delete(sessionId);
  }

  public writeStdin(sessionId: string, data: Uint8Array | string): boolean {
    const s = this.sessions.get(sessionId);
    return s ? s.writeStdin(data) : false;
  }

  public pushOutput(
    sessionId: string,
    data: Uint8Array | string,
    channel: "stdout" | "stderr" = "stdout",
  ): number {
    const s = this.sessions.get(sessionId);
    return s ? s.pushOutput(data, channel) : 0;
  }

  public resizeSession(sessionId: string, dimensions: TerminalDimensions): boolean {
    const s = this.sessions.get(sessionId);
    return s ? s.resize(dimensions) : false;
  }

  public pauseSession(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    return s ? s.pause() : false;
  }

  public resumeSession(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    return s ? s.resume() : false;
  }

  public terminateSession(sessionId: string, exitCode = 0): boolean {
    const s = this.sessions.get(sessionId);
    return s ? s.terminate(exitCode) : false;
  }

  public getScrollback(sessionId: string, maxLines?: number, maxBytes?: number): readonly string[] {
    const s = this.sessions.get(sessionId);
    return s ? s.getScrollback(maxLines, maxBytes) : [];
  }

  public getStats(sessionId: string): PtySessionStats | null {
    const s = this.sessions.get(sessionId);
    return s ? s.getStats() : null;
  }

  public onOutput(sessionId: string, l: PtyOutputListener): () => void {
    return this.sessions.get(sessionId)?.onOutput(l) ?? (() => {});
  }
  public onResize(sessionId: string, l: PtyResizeListener): () => void {
    return this.sessions.get(sessionId)?.onResize(l) ?? (() => {});
  }
  public onExit(sessionId: string, l: PtyExitListener): () => void {
    return this.sessions.get(sessionId)?.onExit(l) ?? (() => {});
  }
  public onError(sessionId: string, l: PtyErrorListener): () => void {
    return this.sessions.get(sessionId)?.onError(l) ?? (() => {});
  }

  public dispose(): void {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
  }
}

export function createPtyMultiplexer(): PtyMultiplexer {
  return new PtyMultiplexer();
}

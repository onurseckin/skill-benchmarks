import type {
  AnsiSequenceMatch, BackpressureOptions, MultiplexerSessionStatus, PtyErrorListener,
  PtyExitListener, PtyMultiplexerInstance, PtyOutputListener, PtyResizeListener,
  PtySessionConfig, PtySessionState, PtySessionStats, RingBufferEntry, RingBufferOptions,
  StreamChannel, TerminalDimensions,
} from "./types.js";

const ANSI_REGEX = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%_~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%_~_]*)*)?\\u0007)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
  "g"
);
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, "");
}

export function parseAnsiSequences(input: string): readonly AnsiSequenceMatch[] {
  const matches: AnsiSequenceMatch[] = [];
  const regex = new RegExp(ANSI_REGEX.source, "g");
  let m: RegExpExecArray | null = regex.exec(input);
  while (m !== null) {
    const raw = m[0];
    const cmd = raw.slice(-1);
    const paramStr = raw.slice(2, -1);
    const params = paramStr ? paramStr.split(";").map((p) => parseInt(p, 10)).filter((p) => !isNaN(p)) : [];
    matches.push({
      raw,
      command: cmd,
      params,
      isColor: cmd === "m",
      isCursor: ["A", "B", "C", "D", "E", "F", "G", "H", "f"].includes(cmd),
    });
    m = regex.exec(input);
  }
  return matches;
}

export class RingBuffer {
  private readonly maxBytes: number;
  private readonly maxLines: number;
  private readonly entries: RingBufferEntry[] = [];
  private currentBytes = 0;
  private totalDropped = 0;

  public constructor(options: RingBufferOptions = {}) {
    this.maxBytes = options.maxCapacityBytes ?? 1024 * 1024;
    this.maxLines = options.maxCapacityLines ?? 5000;
  }

  public push(data: Uint8Array, channel: StreamChannel, sequence: number, timestamp: number): void {
    const text = TEXT_DECODER.decode(data);
    while ((this.entries.length >= this.maxLines || this.currentBytes + data.byteLength > this.maxBytes) && this.entries.length > 0) {
      const removed = this.entries.shift();
      if (removed) {
        this.currentBytes -= removed.data.byteLength;
        this.totalDropped += 1;
      }
    }
    this.entries.push({ sequence, channel, data, text, timestamp });
    this.currentBytes += data.byteLength;
  }

  public getScrollback(maxLines?: number, maxBytes?: number): readonly string[] {
    const linesLimit = maxLines ?? this.maxLines;
    const bytesLimit = maxBytes ?? this.maxBytes;
    const result: string[] = [];
    let accBytes = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (!entry) continue;
      if (result.length >= linesLimit || (accBytes + entry.data.byteLength > bytesLimit && result.length > 0)) break;
      result.unshift(entry.text);
      accBytes += entry.data.byteLength;
    }
    return result;
  }

  public getMemoryUsage(): number { return this.currentBytes; }
  public getEntryCount(): number { return this.entries.length; }
  public getDroppedCount(): number { return this.totalDropped; }
  public clear(): void { this.entries.length = 0; this.currentBytes = 0; this.totalDropped = 0; }
}

export class RateLimiter {
  private readonly rateLimitBytesPerSec: number;
  private readonly throttleIntervalMs: number;
  private tokens: number;
  private lastRefillAt: number;

  public constructor(options: BackpressureOptions = {}) {
    this.rateLimitBytesPerSec = options.rateLimitBytesPerSec ?? 5 * 1024 * 1024;
    this.throttleIntervalMs = options.throttleIntervalMs ?? 50;
    this.tokens = this.rateLimitBytesPerSec;
    this.lastRefillAt = Date.now();
  }

  public consume(bytes: number): boolean {
    this.refill();
    if (this.tokens >= bytes) {
      this.tokens -= bytes;
      return true;
    }
    return false;
  }

  public getWaitTimeMs(bytes: number): number {
    this.refill();
    if (this.tokens >= bytes) return 0;
    return Math.ceil(((bytes - this.tokens) / this.rateLimitBytesPerSec) * 1000);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillAt;
    if (elapsed >= this.throttleIntervalMs) {
      this.tokens = Math.min(this.rateLimitBytesPerSec, this.tokens + (elapsed / 1000) * this.rateLimitBytesPerSec);
      this.lastRefillAt = now;
    }
  }

  public reset(): void {
    this.tokens = this.rateLimitBytesPerSec;
    this.lastRefillAt = Date.now();
  }
}

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
    this.ringBuffer = new RingBuffer({ maxCapacityBytes: config.ringBufferCapacityBytes, maxCapacityLines: config.ringBufferCapacityLines });
    this.rateLimiter = new RateLimiter({ rateLimitBytesPerSec: config.rateLimitBytesPerSec, throttleIntervalMs: config.throttleIntervalMs });
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
      try { l(bytes, channel, seq); } catch (e) { this.emitError(e instanceof Error ? e : new Error(String(e))); }
    }
    return seq;
  }

  public resize(dimensions: TerminalDimensions): boolean {
    if (this.status === "TERMINATED") return false;
    this.dims = dimensions;
    this.updatedAtIso = new Date().toISOString();
    for (const l of this.onResizeListeners) {
      try { l(dimensions); } catch (e) { this.emitError(e instanceof Error ? e : new Error(String(e))); }
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
      try { l(exitCode); } catch (e) { this.emitError(e instanceof Error ? e : new Error(String(e))); }
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

  public setClientCount(count: number): void { this.clients = Math.max(0, count); }

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

  public hasSession(sessionId: string): boolean { return this.sessions.has(sessionId); }
  public listSessions(): readonly PtySessionState[] { return Array.from(this.sessions.values()).map((s) => s.getState()); }

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

  public pushOutput(sessionId: string, data: Uint8Array | string, channel: "stdout" | "stderr" = "stdout"): number {
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

  public onOutput(sessionId: string, l: PtyOutputListener): () => void { return this.sessions.get(sessionId)?.onOutput(l) ?? (() => {}); }
  public onResize(sessionId: string, l: PtyResizeListener): () => void { return this.sessions.get(sessionId)?.onResize(l) ?? (() => {}); }
  public onExit(sessionId: string, l: PtyExitListener): () => void { return this.sessions.get(sessionId)?.onExit(l) ?? (() => {}); }
  public onError(sessionId: string, l: PtyErrorListener): () => void { return this.sessions.get(sessionId)?.onError(l) ?? (() => {}); }

  public dispose(): void {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
  }
}

export function createPtyMultiplexer(): PtyMultiplexer {
  return new PtyMultiplexer();
}

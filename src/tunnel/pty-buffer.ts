import type {
  AnsiSequenceMatch,
  BackpressureOptions,
  RingBufferEntry,
  RingBufferOptions,
  StreamChannel,
} from "./types.js";

const ANSI_REGEX = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%_~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%_~_]*)*)?\\u0007)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
  "g",
);
const TEXT_DECODER = new TextDecoder();

export function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, "");
}

export function parseAnsiSequences(input: string): readonly AnsiSequenceMatch[] {
  const matches: AnsiSequenceMatch[] = [];
  const regex = new RegExp(ANSI_REGEX.source, "g");
  let match: RegExpExecArray | null = regex.exec(input);
  while (match !== null) {
    const raw = match[0];
    const command = raw.slice(-1);
    const parameterText = raw.slice(2, -1);
    const params = parameterText
      ? parameterText
          .split(";")
          .map((parameter) => parseInt(parameter, 10))
          .filter((parameter) => !isNaN(parameter))
      : [];
    matches.push({
      raw,
      command,
      params,
      isColor: command === "m",
      isCursor: ["A", "B", "C", "D", "E", "F", "G", "H", "f"].includes(command),
    });
    match = regex.exec(input);
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
    while (
      (this.entries.length >= this.maxLines ||
        this.currentBytes + data.byteLength > this.maxBytes) &&
      this.entries.length > 0
    ) {
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
    let accumulatedBytes = 0;
    for (let index = this.entries.length - 1; index >= 0; index--) {
      const entry = this.entries[index];
      if (!entry) continue;
      if (
        result.length >= linesLimit ||
        (accumulatedBytes + entry.data.byteLength > bytesLimit && result.length > 0)
      ) {
        break;
      }
      result.unshift(entry.text);
      accumulatedBytes += entry.data.byteLength;
    }
    return result;
  }

  public getMemoryUsage(): number {
    return this.currentBytes;
  }

  public getEntryCount(): number {
    return this.entries.length;
  }

  public getDroppedCount(): number {
    return this.totalDropped;
  }

  public clear(): void {
    this.entries.length = 0;
    this.currentBytes = 0;
    this.totalDropped = 0;
  }
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
      this.tokens = Math.min(
        this.rateLimitBytesPerSec,
        this.tokens + (elapsed / 1000) * this.rateLimitBytesPerSec,
      );
      this.lastRefillAt = now;
    }
  }

  public reset(): void {
    this.tokens = this.rateLimitBytesPerSec;
    this.lastRefillAt = Date.now();
  }
}

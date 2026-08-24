import * as fs from "node:fs";
import * as path from "node:path";
import type {
  TelemetryEvent,
  TelemetryEventType,
  ResourceProfileSample,
} from "./types.js";

export const DEFAULT_MAX_OUTPUT_BYTES_PER_COMMAND = 5 * 1024 * 1024;
export const DEFAULT_BATCH_SIZE = 50;
export const DEFAULT_FLUSH_INTERVAL_MS = 100;
export const DEFAULT_RECENT_LINES_COUNT = 100;

let lastTimestampUs = 0n;

export function getMonotonicMicroseconds(): string {
  let nowUs =
    BigInt(Math.round(performance.timeOrigin * 1000)) +
    BigInt(Math.round(performance.now() * 1000));
  if (nowUs <= lastTimestampUs) {
    nowUs = lastTimestampUs + 1n;
  }
  lastTimestampUs = nowUs;
  return nowUs.toString();
}

export function createTelemetryEvent(
  runId: string,
  sequenceNumber: number,
  type: TelemetryEventType,
  payload: Readonly<Record<string, unknown>> = {}
): TelemetryEvent {
  return { runId, sequenceNumber, timestampUs: getMonotonicMicroseconds(), type, payload };
}

export interface EventScribeOptions {
  readonly runId: string;
  readonly outputDir: string;
  readonly maxOutputBytesPerCommand?: number;
  readonly batchSize?: number;
  readonly flushIntervalMs?: number;
  readonly retainRecentLinesCount?: number;
}

export interface RecordChunkResult {
  readonly event: TelemetryEvent;
  readonly truncated: boolean;
  readonly bytesWritten: number;
}

export class EventScribe {
  public readonly runId: string;
  public readonly outputDir: string;
  public readonly eventsFilePath: string;
  public readonly rawLogFilePath: string;
  public readonly maxOutputBytesPerCommand: number;
  public readonly batchSize: number;
  public readonly flushIntervalMs: number;
  public readonly retainRecentLinesCount: number;

  private sequenceNumber: number = 0;
  private readonly commandByteCounts: Map<string, number> = new Map();
  private readonly commandTruncated: Set<string> = new Set();

  private eventBuffer: string[] = [];
  private rawLogBuffer: string[] = [];

  private recentStdout: string[] = [];
  private recentStderr: string[] = [];

  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isClosed: boolean = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(options: EventScribeOptions) {
    this.runId = options.runId;
    this.outputDir = options.outputDir;
    this.eventsFilePath = path.join(this.outputDir, "events.jsonl");
    this.rawLogFilePath = path.join(this.outputDir, "raw.log");
    this.maxOutputBytesPerCommand =
      options.maxOutputBytesPerCommand ?? DEFAULT_MAX_OUTPUT_BYTES_PER_COMMAND;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushIntervalMs =
      options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.retainRecentLinesCount =
      options.retainRecentLinesCount ?? DEFAULT_RECENT_LINES_COUNT;

    if (this.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => {
        void this.flush();
      }, this.flushIntervalMs);
      if (typeof this.flushTimer === "object" && "unref" in this.flushTimer) {
        this.flushTimer.unref();
      }
    }
  }

  public get currentSequenceNumber(): number {
    return this.sequenceNumber;
  }

  public emit(
    type: TelemetryEventType,
    payload: Readonly<Record<string, unknown>> = {}
  ): TelemetryEvent {
    this.sequenceNumber += 1;
    const event = createTelemetryEvent(this.runId, this.sequenceNumber, type, payload);
    this.eventBuffer.push(JSON.stringify(event) + "\n");
    if (this.eventBuffer.length >= this.batchSize) void this.flush();
    return event;
  }

  public startCommand(
    commandId: string,
    payload: Readonly<Record<string, unknown>> = {}
  ): TelemetryEvent {
    this.commandByteCounts.set(commandId, 0);
    this.commandTruncated.delete(commandId);

    return this.emit("TOOL_CALL_STARTED", {
      commandId,
      ...payload,
    });
  }

  public recordStdout(
    commandId: string,
    chunk: string | Uint8Array,
    metadata: Readonly<Record<string, unknown>> = {}
  ): RecordChunkResult {
    const rawBytes =
      typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : Buffer.from(chunk);
    const chunkByteLength = rawBytes.length;

    const currentCount = this.commandByteCounts.get(commandId) ?? 0;
    const alreadyTruncated = this.commandTruncated.has(commandId);

    if (alreadyTruncated) {
      const event = this.emit("TOOL_STDOUT_CHUNK", {
        commandId,
        chunk: "",
        output_truncated: true,
        bytesRecorded: currentCount,
        limitBytes: this.maxOutputBytesPerCommand,
        dropped: true,
        ...metadata,
      });
      return { event, truncated: true, bytesWritten: 0 };
    }

    const remainingAllowed = this.maxOutputBytesPerCommand - currentCount;

    if (remainingAllowed <= 0) {
      this.commandTruncated.add(commandId);
      const event = this.emit("TOOL_STDOUT_CHUNK", {
        commandId,
        chunk: "",
        output_truncated: true,
        bytesRecorded: currentCount,
        limitBytes: this.maxOutputBytesPerCommand,
        dropped: true,
        ...metadata,
      });
      return { event, truncated: true, bytesWritten: 0 };
    }

    let bytesToWrite = chunkByteLength;
    let willTruncate = false;
    let bufferToWrite = rawBytes;

    if (chunkByteLength > remainingAllowed) {
      willTruncate = true;
      bytesToWrite = remainingAllowed;
      bufferToWrite = rawBytes.subarray(0, remainingAllowed);
      this.commandTruncated.add(commandId);
    }

    const textToWrite = bufferToWrite.toString("utf-8");
    const newTotal = currentCount + bytesToWrite;
    this.commandByteCounts.set(commandId, newTotal);

    this.rawLogBuffer.push(textToWrite);

    this.appendRecentLines(this.recentStdout, textToWrite);

    const event = this.emit("TOOL_STDOUT_CHUNK", {
      commandId,
      chunk: textToWrite,
      output_truncated: willTruncate,
      bytesRecorded: newTotal,
      limitBytes: this.maxOutputBytesPerCommand,
      ...metadata,
    });

    return {
      event,
      truncated: willTruncate,
      bytesWritten: bytesToWrite,
    };
  }

  public recordStderr(
    commandId: string,
    chunk: string | Uint8Array,
    metadata: Readonly<Record<string, unknown>> = {}
  ): RecordChunkResult {
    const rawBytes =
      typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : Buffer.from(chunk);
    const chunkByteLength = rawBytes.length;

    const currentCount = this.commandByteCounts.get(commandId) ?? 0;
    const alreadyTruncated = this.commandTruncated.has(commandId);

    if (alreadyTruncated) {
      const event = this.emit("TOOL_STDERR_CHUNK", {
        commandId,
        chunk: "",
        output_truncated: true,
        bytesRecorded: currentCount,
        limitBytes: this.maxOutputBytesPerCommand,
        dropped: true,
        ...metadata,
      });
      return { event, truncated: true, bytesWritten: 0 };
    }

    const remainingAllowed = this.maxOutputBytesPerCommand - currentCount;

    if (remainingAllowed <= 0) {
      this.commandTruncated.add(commandId);
      const event = this.emit("TOOL_STDERR_CHUNK", {
        commandId,
        chunk: "",
        output_truncated: true,
        bytesRecorded: currentCount,
        limitBytes: this.maxOutputBytesPerCommand,
        dropped: true,
        ...metadata,
      });
      return { event, truncated: true, bytesWritten: 0 };
    }

    let bytesToWrite = chunkByteLength;
    let willTruncate = false;
    let bufferToWrite = rawBytes;

    if (chunkByteLength > remainingAllowed) {
      willTruncate = true;
      bytesToWrite = remainingAllowed;
      bufferToWrite = rawBytes.subarray(0, remainingAllowed);
      this.commandTruncated.add(commandId);
    }

    const textToWrite = bufferToWrite.toString("utf-8");
    const newTotal = currentCount + bytesToWrite;
    this.commandByteCounts.set(commandId, newTotal);

    this.rawLogBuffer.push(textToWrite);

    this.appendRecentLines(this.recentStderr, textToWrite);

    const event = this.emit("TOOL_STDERR_CHUNK", {
      commandId,
      chunk: textToWrite,
      output_truncated: willTruncate,
      bytesRecorded: newTotal,
      limitBytes: this.maxOutputBytesPerCommand,
      ...metadata,
    });

    return {
      event,
      truncated: willTruncate,
      bytesWritten: bytesToWrite,
    };
  }

  public endCommand(
    commandId: string,
    exitCode: number,
    durationMs?: number,
    payload: Readonly<Record<string, unknown>> = {}
  ): TelemetryEvent {
    const totalBytes = this.commandByteCounts.get(commandId) ?? 0;
    const wasTruncated = this.commandTruncated.has(commandId);

    return this.emit("TOOL_CALL_COMPLETED", {
      commandId,
      exitCode,
      durationMs,
      output_truncated: wasTruncated,
      totalBytes,
      ...payload,
    });
  }

  public recordResourceSample(
    sample: ResourceProfileSample
  ): TelemetryEvent {
    return this.emit("RESOURCE_SAMPLE", {
      sample,
    });
  }

  public isCommandTruncated(commandId: string): boolean {
    return this.commandTruncated.has(commandId);
  }

  public getCommandOutputBytes(commandId: string): number {
    return this.commandByteCounts.get(commandId) ?? 0;
  }

  public getRecentStdoutLines(): ReadonlyArray<string> {
    return [...this.recentStdout];
  }

  public getRecentStderrLines(): ReadonlyArray<string> {
    return [...this.recentStderr];
  }

  public async flush(): Promise<void> {
    this.writeLock = this.writeLock.then(async () => {
      if (this.eventBuffer.length === 0 && this.rawLogBuffer.length === 0) {
        return;
      }

      const eventsToWrite = this.eventBuffer.splice(0, this.eventBuffer.length);
      const rawLogsToWrite = this.rawLogBuffer.splice(0, this.rawLogBuffer.length);

      try {
        await fs.promises.mkdir(this.outputDir, { recursive: true });

        if (eventsToWrite.length > 0) {
          await fs.promises.appendFile(
            this.eventsFilePath,
            eventsToWrite.join(""),
            "utf-8"
          );
        }

        if (rawLogsToWrite.length > 0) {
          await fs.promises.appendFile(
            this.rawLogFilePath,
            rawLogsToWrite.join(""),
            "utf-8"
          );
        }
      } catch (err) {
        this.eventBuffer.unshift(...eventsToWrite);
        this.rawLogBuffer.unshift(...rawLogsToWrite);
        throw err;
      }
    });

    await this.writeLock;
  }

  public async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;

    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();
  }

  private appendRecentLines(target: string[], text: string): void {
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.length > 0) {
        target.push(line);
      }
    }
    if (target.length > this.retainRecentLinesCount) {
      target.splice(0, target.length - this.retainRecentLinesCount);
    }
  }
}

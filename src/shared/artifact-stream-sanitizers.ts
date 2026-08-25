import { BenchmarkArtifactTextStreamSanitizer } from "./artifact-sanitization.js";
import { sanitizeBenchmarkArtifactValue } from "./artifact-sanitization.js";

export class ArtifactTextStreamSanitizers {
  private readonly sanitizers = new Map<string, BenchmarkArtifactTextStreamSanitizer>();

  public get(scopeId: string, channel: string): BenchmarkArtifactTextStreamSanitizer {
    const key = `${scopeId.length}:${scopeId}:${channel}`;
    const existing = this.sanitizers.get(key);
    if (existing !== undefined) return existing;
    const sanitizer = new BenchmarkArtifactTextStreamSanitizer();
    this.sanitizers.set(key, sanitizer);
    return sanitizer;
  }

  public clear(scopeId: string): void {
    const prefix = `${scopeId.length}:${scopeId}:`;
    for (const key of this.sanitizers.keys()) {
      if (key.startsWith(prefix)) this.sanitizers.delete(key);
    }
  }

  public clearAll(): void {
    this.sanitizers.clear();
  }
}

export function sanitizeBenchmarkArtifactStreamValue(value: unknown): unknown {
  const streams = new ArtifactTextStreamSanitizers();
  return sanitizeBenchmarkArtifactValue(normalizeStreamRecords(value, streams, ""));
}

function normalizeStreamRecords(
  value: unknown,
  streams: ArtifactTextStreamSanitizers,
  inheritedRunId: string
): unknown {
  if (Array.isArray(value)) {
    return value.map((child) => normalizeStreamRecords(child, streams, inheritedRunId));
  }
  if (value === null || typeof value !== "object") return value;
  const record = value as Readonly<Record<string, unknown>>;
  const runId = resolveRunId(record, inheritedRunId);
  const normalized = Object.fromEntries(
    Object.entries(record).map(([key, child]) => [key, normalizeStreamRecords(child, streams, runId)])
  );
  const commandId = resolveCommandId(record);
  if (commandId === undefined) return normalized;
  const scopeId = `${runId.length}:${runId}:${commandId}`;
  const eventType = resolveEventType(record);
  if (eventType.includes("START")) streams.clear(scopeId);
  const channel = resolveRecordChannel(record, eventType);
  if (typeof normalized.chunk === "string") {
    normalized.chunk = streams.get(scopeId, channel).sanitize(normalized.chunk);
  }
  if (typeof normalized.stdout === "string") {
    normalized.stdout = streams.get(scopeId, "stdout").sanitize(normalized.stdout);
  }
  if (typeof normalized.stderr === "string") {
    normalized.stderr = streams.get(scopeId, "stderr").sanitize(normalized.stderr);
  }
  if (eventType.includes("COMPLET") || eventType.includes("END")) streams.clear(scopeId);
  return normalized;
}

function resolveRunId(record: Readonly<Record<string, unknown>>, inheritedRunId: string): string {
  if (typeof record.runId === "string") return record.runId;
  for (const field of ["cell", "scenarioResult", "runRecord"] as const) {
    const nested = record[field];
    if (nested !== null && typeof nested === "object" && "runId" in nested && typeof nested.runId === "string") {
      return nested.runId;
    }
  }
  return inheritedRunId;
}

function resolveCommandId(record: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof record.commandId === "string") return record.commandId;
  if (typeof record.toolCallId === "string") return record.toolCallId;
  return undefined;
}

function resolveEventType(record: Readonly<Record<string, unknown>>): string {
  const value = typeof record.eventType === "string" ? record.eventType
    : typeof record.type === "string" ? record.type : "";
  return value.toUpperCase();
}

function resolveRecordChannel(record: Readonly<Record<string, unknown>>, eventType: string): string {
  if (typeof record.channel === "string") return record.channel.toLowerCase();
  if (eventType.includes("STDERR")) return "stderr";
  if (eventType.includes("STDOUT")) return "stdout";
  return "output";
}

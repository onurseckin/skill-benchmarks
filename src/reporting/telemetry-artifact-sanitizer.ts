import { sanitizeBenchmarkArtifactValue } from "../shared/artifact-sanitization.js";
import { ArtifactTextStreamSanitizers } from "../shared/artifact-stream-sanitizers.js";
import type { TelemetryEventRecord } from "./types.js";

export class TelemetryArtifactSanitizer {
  private readonly streams = new ArtifactTextStreamSanitizers();

  public sanitize(event: TelemetryEventRecord): TelemetryEventRecord {
    const commandId = typeof event.payload?.commandId === "string" ? event.payload.commandId : undefined;
    const scopeId = commandId === undefined ? undefined : `${event.runId.length}:${event.runId}:${commandId}`;
    if (scopeId !== undefined && event.eventType === "TOOL_CALL_STARTED") this.streams.clear(scopeId);
    const channel = resolveChannel(event.eventType);
    const chunk = event.payload?.chunk;
    const normalizedEvent = scopeId !== undefined && channel !== undefined && typeof chunk === "string"
      ? { ...event, payload: { ...event.payload, chunk: this.streams.get(scopeId, channel).sanitize(chunk) } }
      : event;
    const sanitized = sanitizeBenchmarkArtifactValue(normalizedEvent) as TelemetryEventRecord;
    if (scopeId !== undefined && event.eventType === "TOOL_CALL_COMPLETED") this.streams.clear(scopeId);
    return sanitized;
  }
}

function resolveChannel(eventType: string): "stdout" | "stderr" | undefined {
  if (eventType === "TOOL_STDOUT_CHUNK") return "stdout";
  if (eventType === "TOOL_STDERR_CHUNK") return "stderr";
  return undefined;
}

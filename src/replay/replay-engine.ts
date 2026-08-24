import type {
  ReplayFrameType,
  ReplaySessionStatus,
  ToolCallEvent,
  ThinkingEvent,
  DiffDelta,
  DiffChangeType,
  CgroupTelemetryPoint,
  TrajectoryFrame,
  ReplaySessionMetadata,
  ReplaySession,
  ReplaySummary,
} from "./types.js";

function cleanDiffPath(raw: string): string {
  if (raw.startsWith("b/")) return raw.substring(2);
  if (raw.startsWith("a/")) return raw.substring(2);
  return raw;
}

export class ReplayEngine {
  private metadata: ReplaySessionMetadata;
  private frames: TrajectoryFrame[] = [];
  private telemetrySeries: CgroupTelemetryPoint[] = [];
  private diffs: DiffDelta[] = [];
  private rawEvents: Readonly<Record<string, unknown>>[] = [];
  private currentTurn = 0;
  private startTimeMs: number;

  constructor(initialMetadata?: Partial<ReplaySessionMetadata>) {
    this.startTimeMs = Date.now();
    this.metadata = {
      sessionId: initialMetadata?.sessionId ?? `replay-${Date.now()}`,
      runId: initialMetadata?.runId ?? `run-${Date.now()}`,
      scenarioId: initialMetadata?.scenarioId ?? "unknown-scenario",
      scenarioName: initialMetadata?.scenarioName,
      skillId: initialMetadata?.skillId ?? "unknown-skill",
      skillVersion: initialMetadata?.skillVersion,
      modelId: initialMetadata?.modelId ?? "unknown-model",
      providerId: initialMetadata?.providerId ?? "unknown-provider",
      startTime: initialMetadata?.startTime ?? new Date(this.startTimeMs).toISOString(),
      endTime: initialMetadata?.endTime,
      durationMs: initialMetadata?.durationMs ?? 0,
      status: initialMetadata?.status ?? "completed",
      totalTurns: initialMetadata?.totalTurns ?? 0,
      totalToolCalls: initialMetadata?.totalToolCalls ?? 0,
      totalTokens: initialMetadata?.totalTokens ?? 0,
      totalCostUSD: initialMetadata?.totalCostUSD ?? 0,
      score: initialMetadata?.score,
      exitCode: initialMetadata?.exitCode,
      errorMessage: initialMetadata?.errorMessage,
    };
  }

  public recordEvent(event: Readonly<Record<string, unknown>>): TrajectoryFrame {
    this.rawEvents.push(event);
    const eventTypeStr = typeof event["type"] === "string" ? (event["type"] as string) : "unknown";
    const tsStr = typeof event["timestamp"] === "string" ? (event["timestamp"] as string) : new Date().toISOString();
    const eventTimeMs = new Date(tsStr).getTime() || Date.now();
    const elapsedMs = Math.max(0, eventTimeMs - this.startTimeMs);

    let frameType: ReplayFrameType = "session_start";
    let summary = `Event: ${eventTypeStr}`;
    let toolCall: ToolCallEvent | undefined;
    let thinking: ThinkingEvent | undefined;
    let diff: DiffDelta | undefined;
    let telemetry: CgroupTelemetryPoint | undefined;

    if (eventTypeStr === "run:start" || eventTypeStr === "SESSION_START") {
      frameType = "session_start";
      summary = `Session started for scenario: ${this.metadata.scenarioId}`;
    } else if (eventTypeStr === "turn:start" || eventTypeStr === "TURN_START") {
      this.currentTurn += 1;
      frameType = "turn_start";
      summary = `Turn #${this.currentTurn} started`;
    } else if (eventTypeStr === "model:thinking" || eventTypeStr === "THINKING_CHUNK") {
      frameType = "model_thinking";
      const chunk = typeof event["chunk"] === "string" ? event["chunk"] : "";
      const tokens = typeof event["tokens"] === "number" ? event["tokens"] : 1;
      thinking = {
        thoughtChunk: chunk,
        tokenCount: tokens,
        timestampUs: tsStr,
      };
      summary = `Thinking: ${chunk.slice(0, 60)}...`;
    } else if (eventTypeStr === "tool:call" || eventTypeStr === "TOOL_CALL_STARTED" || eventTypeStr === "tool:dispatch") {
      frameType = "tool_call";
      const toolName = typeof event["toolName"] === "string" ? event["toolName"] : (typeof event["tool"] === "string" ? event["tool"] : "tool");
      const callId = typeof event["callId"] === "string" ? event["callId"] : `call-${this.frames.length + 1}`;
      const payload = typeof event["payload"] === "object" && event["payload"] !== null ? (event["payload"] as Readonly<Record<string, unknown>>) : {};
      toolCall = {
        toolName,
        callId,
        inputPayload: payload,
        timestampUs: tsStr,
      };
      summary = `Tool Call: ${toolName}`;
    } else if (eventTypeStr === "tool:result" || eventTypeStr === "TOOL_CALL_COMPLETED" || eventTypeStr === "tool:finish") {
      frameType = "tool_output";
      const toolName = typeof event["toolName"] === "string" ? event["toolName"] : "tool";
      const callId = typeof event["callId"] === "string" ? event["callId"] : `call-${this.frames.length + 1}`;
      const stdout = typeof event["stdout"] === "string" ? event["stdout"] : undefined;
      const stderr = typeof event["stderr"] === "string" ? event["stderr"] : undefined;
      const error = typeof event["error"] === "string" ? event["error"] : undefined;
      const durationMs = typeof event["durationMs"] === "number" ? event["durationMs"] : undefined;
      const exitCode = typeof event["exitCode"] === "number" ? event["exitCode"] : 0;
      toolCall = {
        toolName,
        callId,
        inputPayload: {},
        timestampUs: tsStr,
        stdout,
        stderr,
        error,
        durationMs,
        exitCode,
      };
      summary = `Tool Output: ${toolName} (exit: ${exitCode})`;
    } else if (eventTypeStr === "RESOURCE_SAMPLE" || eventTypeStr === "telemetry:sample") {
      frameType = "cgroup_sample";
      telemetry = {
        timestampMs: eventTimeMs,
        cpuPercent: typeof event["cpuPercent"] === "number" ? event["cpuPercent"] : 0,
        memoryRssMb: typeof event["memoryRssMb"] === "number" ? event["memoryRssMb"] : 0,
        memoryLimitMb: typeof event["memoryLimitMb"] === "number" ? event["memoryLimitMb"] : 512,
        memoryPercent: typeof event["memoryPercent"] === "number" ? event["memoryPercent"] : 0,
        diskReadKb: typeof event["diskReadKb"] === "number" ? event["diskReadKb"] : 0,
        diskWriteKb: typeof event["diskWriteKb"] === "number" ? event["diskWriteKb"] : 0,
        networkRxKb: typeof event["networkRxKb"] === "number" ? event["networkRxKb"] : 0,
        networkTxKb: typeof event["networkTxKb"] === "number" ? event["networkTxKb"] : 0,
        activePids: typeof event["activePids"] === "number" ? event["activePids"] : 1,
      };
      this.telemetrySeries.push(telemetry);
      summary = `Telemetry: CPU ${telemetry.cpuPercent.toFixed(1)}%, RSS ${telemetry.memoryRssMb.toFixed(1)}MB`;
    } else if (eventTypeStr === "GIT_DIFF_CAPTURED" || eventTypeStr === "workspace:diff") {
      frameType = "git_diff";
      const rawDiff = typeof event["rawDiff"] === "string" ? event["rawDiff"] : (typeof event["diff"] === "string" ? event["diff"] : "");
      const parsed = this.parseUnifiedDiff(rawDiff);
      if (parsed.length > 0) {
        diff = parsed[0];
        this.diffs.push(...parsed);
        summary = `Git Diff: ${parsed.length} file(s) modified (+${parsed.reduce((acc, d) => acc + d.insertions, 0)}/-${parsed.reduce((acc, d) => acc + d.deletions, 0)})`;
      } else {
        diff = {
          path: typeof event["path"] === "string" ? event["path"] : "workspace",
          changeType: "modified",
          insertions: 0,
          deletions: 0,
          diffHunk: rawDiff,
        };
        this.diffs.push(diff);
        summary = "Git Diff: Workspace modified";
      }
    } else if (eventTypeStr === "turn:finish" || eventTypeStr === "TURN_END") {
      frameType = "turn_end";
      summary = `Turn #${this.currentTurn} completed`;
    } else if (eventTypeStr === "run:finish" || eventTypeStr === "SESSION_END") {
      frameType = "session_end";
      summary = `Session finished with status: ${this.metadata.status}`;
    } else if (eventTypeStr.includes("error") || eventTypeStr.includes("FAIL")) {
      frameType = "error";
      summary = `Error: ${typeof event["message"] === "string" ? event["message"] : eventTypeStr}`;
    }

    const frame: TrajectoryFrame = {
      frameIndex: this.frames.length,
      timestampMs: eventTimeMs,
      eventType: frameType,
      turnIndex: this.currentTurn,
      summary,
      elapsedMs,
      toolCall,
      thinking,
      diff,
      telemetry,
      totalTokens: typeof event["totalTokens"] === "number" ? event["totalTokens"] : undefined,
      totalCostUSD: typeof event["totalCostUSD"] === "number" ? event["totalCostUSD"] : undefined,
    };

    this.frames.push(frame);
    return frame;
  }

  public parseUnifiedDiff(rawDiff: string): readonly DiffDelta[] {
    if (!rawDiff || rawDiff.trim().length === 0) return [];
    const deltas: DiffDelta[] = [];
    const lines = rawDiff.split("\n");
    let currentPath = "";
    let changeType: DiffChangeType = "modified";
    let insertions = 0;
    let deletions = 0;
    const currentHunks: string[] = [];

    for (const line of lines) {
      if (line.startsWith("diff --git ")) {
        if (currentPath.length > 0) {
          deltas.push({
            path: currentPath,
            changeType,
            insertions,
            deletions,
            diffHunk: currentHunks.join("\n"),
          });
          insertions = 0;
          deletions = 0;
          currentHunks.length = 0;
        }
        const parts = line.split(" ");
        const bPart = parts[3] ?? parts[2] ?? "";
        currentPath = cleanDiffPath(bPart);
        changeType = "modified";
      } else if (line.startsWith("new file mode")) {
        changeType = "added";
      } else if (line.startsWith("deleted file mode")) {
        changeType = "deleted";
      } else if (line.startsWith("+++ b/")) {
        currentPath = line.substring(6).trim();
      } else if (line.startsWith("--- a/")) {
        if (!currentPath) currentPath = line.substring(6).trim();
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        insertions += 1;
        currentHunks.push(line);
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions += 1;
        currentHunks.push(line);
      } else if (line.startsWith("@@") || line.startsWith(" ")) {
        currentHunks.push(line);
      }
    }

    if (currentPath.length > 0) {
      deltas.push({
        path: currentPath,
        changeType,
        insertions,
        deletions,
        diffHunk: currentHunks.join("\n"),
      });
    }

    return deltas;
  }

  public parseJsonl(jsonlContent: string): ReplaySession {
    const lines = jsonlContent.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Readonly<Record<string, unknown>>;
        this.recordEvent(parsed);
      } catch {
        continue;
      }
    }
    return this.finalizeSession();
  }

  public parseEvents(
    events: readonly Readonly<Record<string, unknown>>[],
    metadataOverride?: Partial<ReplaySessionMetadata>
  ): ReplaySession {
    if (metadataOverride) {
      this.metadata = { ...this.metadata, ...metadataOverride };
    }
    for (const event of events) {
      this.recordEvent(event);
    }
    return this.finalizeSession();
  }

  public finalizeSession(status?: ReplaySessionStatus): ReplaySession {
    const lastFrame = this.frames[this.frames.length - 1];
    const durationMs = lastFrame ? lastFrame.elapsedMs : 0;
    const totalToolCalls = this.frames.filter((f) => f.toolCall !== undefined).length;
    const finalStatus = status ?? (this.metadata.status || "completed");

    this.metadata = {
      ...this.metadata,
      status: finalStatus,
      durationMs,
      totalTurns: Math.max(1, this.currentTurn),
      totalToolCalls,
      endTime: new Date().toISOString(),
    };

    return {
      metadata: this.metadata,
      frames: Object.freeze([...this.frames]),
      telemetrySeries: Object.freeze([...this.telemetrySeries]),
      diffs: Object.freeze([...this.diffs]),
      rawEvents: Object.freeze([...this.rawEvents]),
    };
  }

  public getFrame(index: number): TrajectoryFrame | undefined {
    return this.frames[index];
  }

  public getFrames(): readonly TrajectoryFrame[] {
    return this.frames;
  }

  public getFrameCount(): number {
    return this.frames.length;
  }

  public findFrames(predicate: (frame: TrajectoryFrame) => boolean): readonly TrajectoryFrame[] {
    return this.frames.filter(predicate);
  }

  public getTelemetryWindow(startMs: number, endMs: number): readonly CgroupTelemetryPoint[] {
    return this.telemetrySeries.filter((pt) => pt.timestampMs >= startMs && pt.timestampMs <= endMs);
  }

  public interpolateTelemetry(timestampMs: number): CgroupTelemetryPoint | undefined {
    if (this.telemetrySeries.length === 0) return undefined;
    if (this.telemetrySeries.length === 1) return this.telemetrySeries[0];

    const exact = this.telemetrySeries.find((pt) => pt.timestampMs === timestampMs);
    if (exact) return exact;

    const sorted = [...this.telemetrySeries].sort((a, b) => a.timestampMs - b.timestampMs);
    if (timestampMs <= sorted[0]!.timestampMs) return sorted[0];
    if (timestampMs >= sorted[sorted.length - 1]!.timestampMs) return sorted[sorted.length - 1];

    for (let i = 0; i < sorted.length - 1; i++) {
      const p1 = sorted[i]!;
      const p2 = sorted[i + 1]!;
      if (timestampMs >= p1.timestampMs && timestampMs <= p2.timestampMs) {
        const span = p2.timestampMs - p1.timestampMs;
        const ratio = span > 0 ? (timestampMs - p1.timestampMs) / span : 0;
        return {
          timestampMs,
          cpuPercent: p1.cpuPercent + (p2.cpuPercent - p1.cpuPercent) * ratio,
          memoryRssMb: p1.memoryRssMb + (p2.memoryRssMb - p1.memoryRssMb) * ratio,
          memoryLimitMb: p1.memoryLimitMb,
          memoryPercent: p1.memoryPercent + (p2.memoryPercent - p1.memoryPercent) * ratio,
          diskReadKb: p1.diskReadKb + (p2.diskReadKb - p1.diskReadKb) * ratio,
          diskWriteKb: p1.diskWriteKb + (p2.diskWriteKb - p1.diskWriteKb) * ratio,
          networkRxKb: p1.networkRxKb + (p2.networkRxKb - p1.networkRxKb) * ratio,
          networkTxKb: p1.networkTxKb + (p2.networkTxKb - p1.networkTxKb) * ratio,
          activePids: Math.round(p1.activePids + (p2.activePids - p1.activePids) * ratio),
        };
      }
    }
    return sorted[0];
  }

  public getSession(): ReplaySession {
    return {
      metadata: this.metadata,
      frames: Object.freeze([...this.frames]),
      telemetrySeries: Object.freeze([...this.telemetrySeries]),
      diffs: Object.freeze([...this.diffs]),
      rawEvents: Object.freeze([...this.rawEvents]),
    };
  }

  public getSummary(): ReplaySummary {
    let peakCpu = 0;
    let peakMem = 0;
    for (const pt of this.telemetrySeries) {
      if (pt.cpuPercent > peakCpu) peakCpu = pt.cpuPercent;
      if (pt.memoryRssMb > peakMem) peakMem = pt.memoryRssMb;
    }
    const totalInsertions = this.diffs.reduce((acc, d) => acc + d.insertions, 0);
    const totalDeletions = this.diffs.reduce((acc, d) => acc + d.deletions, 0);

    return {
      frameCount: this.frames.length,
      turnCount: Math.max(1, this.currentTurn),
      toolCallCount: this.frames.filter((f) => f.toolCall !== undefined).length,
      peakCpuPercent: peakCpu,
      peakMemoryMb: peakMem,
      totalInsertions,
      totalDeletions,
      verdict: this.metadata.status === "completed" ? "SUCCESS" : "FAILED",
    };
  }

  public toJson(pretty = false): string {
    return JSON.stringify(this.getSession(), null, pretty ? 2 : undefined);
  }

  public static fromJson(jsonStr: string): ReplaySession {
    const raw = JSON.parse(jsonStr) as ReplaySession;
    return raw;
  }
}

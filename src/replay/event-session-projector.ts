import type { TelemetryEvent } from "../infrastructure/telemetry/types.js";
import { ReplayEvidenceInvalidError } from "./errors.js";
import { parseUnifiedDiff } from "./unified-diff-parser.js";
import {
  replaySessionSchemaVersion,
  type CgroupTelemetryPoint,
  type CommandEvent,
  type ReplayEvidenceIdentity,
  type ReplayExecutionStatus,
  type ReplayFrameType,
  type ReplaySession,
  type ToolCallEvent,
  type TrajectoryFrame,
} from "./types.js";

export function projectReplaySession(
  events: readonly TelemetryEvent[],
  identity: ReplayEvidenceIdentity = {}
): ReplaySession {
  const first = requireEvent(events[0]);
  const last = requireEvent(events[events.length - 1]);
  const start = first.payload;
  const finish = last.payload;
  assertExpectedIdentity(events, identity);
  const frames = events.map((event, index) => projectFrame(event, index, first.timestampUs));
  const telemetrySeries = frames.flatMap((frame) => frame.telemetry === undefined ? [] : [frame.telemetry]);
  const diffs = events.flatMap((event) => event.type === "GIT_DIFF_CAPTURED"
    ? parseUnifiedDiff(event.payload.rawDiff as string)
    : []);
  const metadata = {
    runId: first.runId,
    scenarioId: start.scenarioId as string,
    skillIds: Object.freeze([...(start.skillIds as string[])]),
    modelId: start.modelId as string,
    ...(identity.providerId === undefined ? {} : { providerId: identity.providerId }),
    ...(identity.executionMode === undefined ? {} : { executionMode: identity.executionMode }),
    ...(identity.simulated === undefined ? {} : { simulated: identity.simulated }),
    startTimestampUs: first.timestampUs,
    endTimestampUs: last.timestampUs,
    ...(identity.startedAt === undefined ? {} : { startedAt: identity.startedAt }),
    ...(identity.completedAt === undefined ? {} : { completedAt: identity.completedAt }),
    durationMs: finish.totalDurationMs as number,
    executionStatus: mapExecutionStatus(finish.terminationReason as string),
    terminationReason: finish.terminationReason as string,
    totalTurns: finish.totalTurns as number,
    totalToolCalls: countToolDispatches(events),
    ...(identity.totalTokens === undefined ? {} : { totalTokens: identity.totalTokens }),
    totalCostUSD: finish.totalCostUSD as number,
  } as const;
  const provenance = {
    source: "persisted-events",
    sourceKind: identity.sourceKind ?? "direct",
    ...(identity.sweepId === undefined ? {} : { sweepId: identity.sweepId }),
    ...(identity.cellId === undefined ? {} : { cellId: identity.cellId }),
    ...(identity.planFingerprint === undefined ? {} : { planFingerprint: identity.planFingerprint }),
    ...(identity.benchmarkCohort === undefined ? {} : { benchmarkCohort: identity.benchmarkCohort }),
    ...(identity.eligibilityStatus === undefined ? {} : { eligibilityStatus: identity.eligibilityStatus }),
    ...(identity.eligibilityReasons === undefined ? {} : { eligibilityReasons: Object.freeze([...identity.eligibilityReasons]) }),
    ...(identity.evaluationStatus === undefined ? {} : { evaluationStatus: identity.evaluationStatus }),
  } as const;
  return Object.freeze({
    schemaVersion: replaySessionSchemaVersion,
    provenance: Object.freeze(provenance),
    metadata: Object.freeze(metadata),
    frames: Object.freeze(frames),
    telemetrySeries: Object.freeze(telemetrySeries),
    diffs: Object.freeze(diffs),
    sourceEvents: Object.freeze([...events]),
  });
}

function projectFrame(event: TelemetryEvent, frameIndex: number, startTimestampUs: string): TrajectoryFrame {
  const elapsed = BigInt(event.timestampUs) - BigInt(startTimestampUs);
  if (elapsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new ReplayEvidenceInvalidError();
  const projection = projectEvent(event);
  return Object.freeze({
    frameIndex,
    sequenceNumber: event.sequenceNumber,
    timestampUs: event.timestampUs,
    sourceEventType: event.type,
    payload: event.payload,
    eventType: projection.eventType,
    summary: projection.summary,
    elapsedUs: elapsed.toString(),
    elapsedMs: Number(elapsed) / 1000,
    ...optionalTurnIndex(event.payload.turnIndex),
    ...projection.details,
  });
}

function projectEvent(event: TelemetryEvent): {
  readonly eventType: ReplayFrameType;
  readonly summary: string;
  readonly details: Partial<TrajectoryFrame>;
} {
  const payload = event.payload;
  if (event.type === "run:start") return { eventType: "session_start", summary: "Execution started", details: {} };
  if (event.type === "run:finish") return {
    eventType: "session_end",
    summary: `Execution ${mapExecutionStatus(payload.terminationReason as string)}`,
    details: { totalCostUSD: payload.totalCostUSD as number },
  };
  if (event.type === "turn:start") return { eventType: "turn_start", summary: `Turn ${payload.turnIndex as number} started`, details: {} };
  if (event.type === "turn:finish") return { eventType: "turn_end", summary: `Turn ${payload.turnIndex as number} finished`, details: {} };
  if (event.type === "turn:error") return { eventType: "error", summary: `Turn ${payload.turnIndex as number} error`, details: {} };
  if (event.type === "tool:dispatch") return projectToolDispatch(event);
  if (event.type === "tool:finish") return projectToolFinish(event);
  if (event.type === "TOOL_CALL_STARTED") return projectCommand(event, "command_start", "Command started");
  if (event.type === "TOOL_STDOUT_CHUNK") return projectCommandChunk(event, "stdout");
  if (event.type === "TOOL_STDERR_CHUNK") return projectCommandChunk(event, "stderr");
  if (event.type === "TOOL_CALL_COMPLETED") return projectCommand(event, "command_end", "Command completed");
  if (event.type === "RESOURCE_SAMPLE") return projectResourceSample(event);
  if (event.type === "GIT_DIFF_CAPTURED") return projectGitDiff(event);
  return { eventType: "generic", summary: `Persisted event: ${event.type}`, details: {} };
}

function projectToolDispatch(event: TelemetryEvent) {
  const payload = event.payload;
  const toolCall: ToolCallEvent = {
    toolName: payload.toolName as string,
    callId: payload.toolCallId as string,
    inputPayload: payload.arguments as Readonly<Record<string, unknown>>,
    timestampUs: event.timestampUs,
  };
  return { eventType: "tool_call" as const, summary: `Tool dispatched: ${toolCall.toolName}`, details: { toolCall } };
}

function projectToolFinish(event: TelemetryEvent) {
  const payload = event.payload;
  const toolCall: ToolCallEvent = {
    toolName: payload.toolName as string,
    callId: payload.toolCallId as string,
    timestampUs: event.timestampUs,
    durationMs: payload.durationMs as number,
    isError: payload.isError as boolean,
    ...(payload.exitCode === undefined ? {} : { exitCode: payload.exitCode as number }),
  };
  return { eventType: "tool_result" as const, summary: `Tool finished: ${toolCall.toolName}`, details: { toolCall } };
}

function projectCommand(event: TelemetryEvent, eventType: "command_start" | "command_end", summary: string) {
  const payload = event.payload;
  const command: CommandEvent = {
    commandId: payload.commandId as string,
    ...(payload.durationMs === undefined ? {} : { durationMs: payload.durationMs as number }),
    ...(payload.exitCode === undefined ? {} : { exitCode: payload.exitCode as number }),
    ...(payload.output_truncated === undefined ? {} : { outputTruncated: payload.output_truncated as boolean }),
  };
  return { eventType, summary, details: { command } };
}

function projectCommandChunk(event: TelemetryEvent, stream: "stdout" | "stderr") {
  const payload = event.payload;
  const command: CommandEvent = {
    commandId: payload.commandId as string,
    stream,
    chunk: payload.chunk as string,
    outputTruncated: payload.output_truncated as boolean,
  };
  return { eventType: "command_stream" as const, summary: `Command ${stream} chunk`, details: { command } };
}

function projectResourceSample(event: TelemetryEvent) {
  const sample = event.payload.sample as Readonly<Record<string, number>>;
  const telemetry: CgroupTelemetryPoint = {
    timestampMs: sample.timestampMs as number,
    cpuPercent: sample.cpuPercent as number,
    memoryRssMb: bytesToMegabytes(sample.memoryRssBytes as number),
    memoryLimitMb: bytesToMegabytes(sample.memoryLimitBytes as number),
    memoryPercent: sample.memoryPercent as number,
    diskReadKb: bytesToKilobytes(sample.diskReadBytes as number),
    diskWriteKb: bytesToKilobytes(sample.diskWriteBytes as number),
    networkRxKb: bytesToKilobytes(sample.networkRxBytes as number),
    networkTxKb: bytesToKilobytes(sample.networkTxBytes as number),
    activePids: sample.activePids as number,
  };
  return { eventType: "resource_sample" as const, summary: "Resource sample recorded", details: { telemetry } };
}

function projectGitDiff(event: TelemetryEvent) {
  const deltas = parseUnifiedDiff(event.payload.rawDiff as string);
  return {
    eventType: "git_diff" as const,
    summary: "Git diff captured",
    details: deltas[0] === undefined ? {} : { diff: deltas[0] },
  };
}

function assertExpectedIdentity(events: readonly TelemetryEvent[], identity: ReplayEvidenceIdentity): void {
  const first = requireEvent(events[0]);
  const last = requireEvent(events[events.length - 1]);
  const start = first.payload;
  const finish = last.payload;
  requireEqual(identity.runId, first.runId);
  requireEqual(identity.scenarioId, start.scenarioId);
  requireEqual(identity.modelId, start.modelId);
  if (identity.skillId !== undefined) {
    const skills = start.skillIds as readonly string[];
    if (skills.length !== 1 || skills[0] !== identity.skillId) throw new ReplayEvidenceInvalidError();
  }
  requireEqual(identity.terminationReason, finish.terminationReason);
  requireEqual(identity.status, mapExecutionStatus(finish.terminationReason as string));
  requireRoundedEqual(identity.durationMs, finish.totalDurationMs as number, 2);
  requireRoundedEqual(identity.totalCostUSD, finish.totalCostUSD as number, 6);
  requireEqual(identity.totalTurns, finish.totalTurns);
}

function mapExecutionStatus(reason: string): ReplayExecutionStatus {
  if (reason === "success") return "completed";
  if (reason === "timeout") return "timed_out";
  if (reason === "aborted") return "aborted";
  return "failed";
}

function countToolDispatches(events: readonly TelemetryEvent[]): number {
  return events.filter((event) => event.type === "tool:dispatch" || event.type === "TOOL_CALL_STARTED").length;
}

function optionalTurnIndex(value: unknown): { readonly turnIndex?: number } {
  return typeof value === "number" ? { turnIndex: value } : {};
}

function bytesToMegabytes(value: number): number {
  return value / (1024 * 1024);
}

function bytesToKilobytes(value: number): number {
  return value / 1024;
}

function requireEvent(value: TelemetryEvent | undefined): TelemetryEvent {
  if (value === undefined) throw new ReplayEvidenceInvalidError();
  return value;
}

function requireEqual(expected: unknown, actual: unknown): void {
  if (expected !== undefined && expected !== actual) throw new ReplayEvidenceInvalidError();
}

function requireRoundedEqual(expected: number | undefined, actual: number, decimals: number): void {
  if (expected !== undefined && expected !== Number(actual.toFixed(decimals))) throw new ReplayEvidenceInvalidError();
}

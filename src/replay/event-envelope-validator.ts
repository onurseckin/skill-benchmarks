import type { TelemetryEvent } from "../infrastructure/telemetry/types.js";
import { ReplayEvidenceInvalidError } from "./errors.js";

const terminationReasons = new Set([
  "success",
  "max_turns",
  "timeout",
  "budget_exceeded",
  "aborted",
  "tool_error_loop",
  "persistence_failed",
  "error",
]);

export function parseCanonicalEventLines(content: string): readonly TelemetryEvent[] {
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new ReplayEvidenceInvalidError();
  const events = lines.map((line) => parseEventLine(line));
  return validateCanonicalEvents(events);
}

export function validateCanonicalEvents(values: readonly unknown[]): readonly TelemetryEvent[] {
  if (values.length === 0) throw new ReplayEvidenceInvalidError();
  const events = values.map((value) => validateEnvelope(value));
  const first = events[0];
  const last = events[events.length - 1];
  if (first?.type !== "run:start" || last?.type !== "run:finish") throw new ReplayEvidenceInvalidError();
  if (events.filter((event) => event.type === "run:start").length !== 1) throw new ReplayEvidenceInvalidError();
  if (events.filter((event) => event.type === "run:finish").length !== 1) throw new ReplayEvidenceInvalidError();
  const runId = first.runId;
  let previousTimestamp = 0n;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined || event.runId !== runId || event.sequenceNumber !== index + 1) {
      throw new ReplayEvidenceInvalidError();
    }
    const timestamp = BigInt(event.timestampUs);
    if (timestamp <= previousTimestamp) throw new ReplayEvidenceInvalidError();
    previousTimestamp = timestamp;
    validateKnownPayload(event);
  }
  return events;
}

function parseEventLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    throw new ReplayEvidenceInvalidError();
  }
}

function validateEnvelope(value: unknown): TelemetryEvent {
  const record = requireRecord(value);
  const runId = requireNonemptyString(record.runId);
  const sequenceNumber = requirePositiveInteger(record.sequenceNumber);
  const timestampUs = requirePositiveDecimal(record.timestampUs);
  const type = requireNonemptyString(record.type);
  const payload = requireRecord(record.payload);
  if (!hasOnlyKeys(record, ["runId", "sequenceNumber", "timestampUs", "type", "payload"])) {
    throw new ReplayEvidenceInvalidError();
  }
  return { runId, sequenceNumber, timestampUs, type, payload };
}

function validateKnownPayload(event: TelemetryEvent): void {
  const payload = event.payload;
  if (event.type === "run:start") validateRunStart(event.runId, payload);
  else if (event.type === "run:finish") validateRunFinish(event.runId, payload);
  else if (event.type === "turn:start") validateTurnStart(payload);
  else if (event.type === "turn:finish") validateTurnFinish(payload);
  else if (event.type === "turn:error") validateTurnError(payload);
  else if (event.type === "tool:dispatch") validateToolDispatch(payload);
  else if (event.type === "tool:finish") validateToolFinish(payload);
  else if (event.type === "TOOL_CALL_STARTED") validateCommandStart(payload);
  else if (event.type === "TOOL_STDOUT_CHUNK" || event.type === "TOOL_STDERR_CHUNK") validateCommandChunk(payload);
  else if (event.type === "TOOL_CALL_COMPLETED") validateCommandComplete(payload);
  else if (event.type === "RESOURCE_SAMPLE") validateResourceSample(payload);
  else if (event.type === "GIT_DIFF_CAPTURED") validateGitDiff(payload);
}

function validateRunStart(runId: string, payload: Readonly<Record<string, unknown>>): void {
  if (
    requireNonemptyString(payload.runId) !== runId
    || requireNonemptyString(payload.scenarioId).length === 0
    || requireNonemptyString(payload.modelId).length === 0
    || !isNonemptyStringArray(payload.skillIds)
  ) throw new ReplayEvidenceInvalidError();
  requireRecord(payload.limits);
}

function validateRunFinish(runId: string, payload: Readonly<Record<string, unknown>>): void {
  if (requireNonemptyString(payload.runId) !== runId) throw new ReplayEvidenceInvalidError();
  const reason = requireNonemptyString(payload.terminationReason);
  if (!terminationReasons.has(reason)) throw new ReplayEvidenceInvalidError();
  requireNonnegativeNumber(payload.totalDurationMs);
  requireNonnegativeNumber(payload.totalCostUSD);
  requireNonnegativeInteger(payload.totalTurns);
  if (typeof payload.completed !== "boolean" || payload.completed !== (reason === "success")) {
    throw new ReplayEvidenceInvalidError();
  }
}

function validateTurnStart(payload: Readonly<Record<string, unknown>>): void {
  requireNonnegativeInteger(payload.turnIndex);
  requireNonnegativeInteger(payload.messageCount);
}

function validateTurnFinish(payload: Readonly<Record<string, unknown>>): void {
  requireNonnegativeInteger(payload.turnIndex);
  requireNonnegativeNumber(payload.turnCostUSD);
  requireNonnegativeNumber(payload.turnDurationMs);
  requireNonnegativeInteger(payload.toolCallsCount);
  requireNonnegativeInteger(payload.toolErrorsCount);
  requireNonemptyString(payload.finishReason);
}

function validateTurnError(payload: Readonly<Record<string, unknown>>): void {
  requireNonnegativeInteger(payload.turnIndex);
  requireNonemptyString(payload.error);
}

function validateToolDispatch(payload: Readonly<Record<string, unknown>>): void {
  requireNonnegativeInteger(payload.turnIndex);
  requireNonemptyString(payload.toolCallId);
  requireNonemptyString(payload.toolName);
  requireRecord(payload.arguments);
}

function validateToolFinish(payload: Readonly<Record<string, unknown>>): void {
  requireNonnegativeInteger(payload.turnIndex);
  requireNonemptyString(payload.toolCallId);
  requireNonemptyString(payload.toolName);
  if (typeof payload.isError !== "boolean") throw new ReplayEvidenceInvalidError();
  requireNonnegativeNumber(payload.durationMs);
  if (payload.exitCode !== undefined) requireInteger(payload.exitCode);
}

function validateCommandStart(payload: Readonly<Record<string, unknown>>): void {
  requireNonemptyString(payload.commandId);
}

function validateCommandChunk(payload: Readonly<Record<string, unknown>>): void {
  requireNonemptyString(payload.commandId);
  requireString(payload.chunk);
  if (typeof payload.output_truncated !== "boolean") throw new ReplayEvidenceInvalidError();
  requireNonnegativeInteger(payload.bytesRecorded);
  requireNonnegativeInteger(payload.limitBytes);
  if (payload.dropped !== undefined && typeof payload.dropped !== "boolean") throw new ReplayEvidenceInvalidError();
}

function validateCommandComplete(payload: Readonly<Record<string, unknown>>): void {
  requireNonemptyString(payload.commandId);
  requireInteger(payload.exitCode);
  if (payload.durationMs !== undefined) requireNonnegativeNumber(payload.durationMs);
  if (typeof payload.output_truncated !== "boolean") throw new ReplayEvidenceInvalidError();
  requireNonnegativeInteger(payload.totalBytes);
}

function validateResourceSample(payload: Readonly<Record<string, unknown>>): void {
  const sample = requireRecord(payload.sample);
  const numericKeys = [
    "timestampMs", "cpuPercent", "cpuUserUs", "cpuKernelUs", "memoryRssBytes",
    "memoryCacheBytes", "memoryLimitBytes", "memoryPercent", "diskReadBytes",
    "diskWriteBytes", "networkRxBytes", "networkTxBytes", "activePids",
  ] as const;
  for (const key of numericKeys) requireNonnegativeNumber(sample[key]);
  requireNonnegativeInteger(sample.activePids);
}

function validateGitDiff(payload: Readonly<Record<string, unknown>>): void {
  requireString(payload.rawDiff);
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ReplayEvidenceInvalidError();
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireString(value: unknown): string {
  if (typeof value !== "string") throw new ReplayEvidenceInvalidError();
  return value;
}

function requireNonemptyString(value: unknown): string {
  const text = requireString(value);
  if (text.trim().length === 0) throw new ReplayEvidenceInvalidError();
  return text;
}

function requirePositiveDecimal(value: unknown): string {
  const text = requireString(value);
  if (!/^[1-9][0-9]*$/.test(text)) throw new ReplayEvidenceInvalidError();
  return text;
}

function requireInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new ReplayEvidenceInvalidError();
  return value;
}

function requirePositiveInteger(value: unknown): number {
  const number = requireInteger(value);
  if (number < 1) throw new ReplayEvidenceInvalidError();
  return number;
}

function requireNonnegativeInteger(value: unknown): number {
  const number = requireInteger(value);
  if (number < 0) throw new ReplayEvidenceInvalidError();
  return number;
}

function requireNonnegativeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new ReplayEvidenceInvalidError();
  return value;
}

function isNonemptyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function hasOnlyKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

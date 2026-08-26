import { readFileSync } from "node:fs";
import {
  type JsonRecord,
  failVerification,
  requireCondition,
  requireEqualStringArrays,
  requireExactKeys,
  requireExactValue,
  requireFiniteNumber,
  requireInteger,
  requireRecord,
  requireString,
} from "./assertions.js";
import type { DiagnosticArtifacts } from "./artifacts.js";
import { requireNoDiagnosticClaims } from "./claims.js";

interface DiagnosticEvent {
  readonly sequenceNumber: number;
  readonly timestampUs: string;
  readonly type: string;
  readonly payload: JsonRecord;
}

const expectedEventTypes = [
  "run:start",
  "turn:start",
  "tool:dispatch",
  "tool:finish",
  "turn:finish",
  "turn:start",
  "tool:dispatch",
  "tool:finish",
  "turn:finish",
  "turn:start",
  "turn:finish",
  "run:finish",
] as const;

const outerEventKeys = ["runId", "sequenceNumber", "timestampUs", "type", "payload"] as const;
const turnStartKeys = ["turnIndex", "messageCount"] as const;
const turnFinishKeys = [
  "turnIndex",
  "turnCostUSD",
  "turnDurationMs",
  "toolCallsCount",
  "toolErrorsCount",
  "finishReason",
] as const;

function parseEventLine(line: string): JsonRecord {
  try {
    const parsed: unknown = JSON.parse(line);
    return requireRecord(parsed, "events_json_invalid");
  } catch {
    return failVerification("events_json_invalid");
  }
}

function validateTurnEvents(events: readonly DiagnosticEvent[]): void {
  const starts = [events[1], events[5], events[9]];
  const finishes = [events[4], events[8], events[10]];
  for (const [turnIndex, event] of starts.entries()) {
    requireCondition(event !== undefined, "events_turn_order_invalid");
    requireExactKeys(event.payload, turnStartKeys, "events_turn_shape_invalid");
    requireExactValue(event.payload.turnIndex, turnIndex, "events_turn_order_invalid");
    requireExactValue(event.payload.messageCount, 2 + turnIndex * 2, "events_turn_order_invalid");
  }
  for (const [turnIndex, event] of finishes.entries()) {
    requireCondition(event !== undefined, "events_turn_order_invalid");
    requireExactKeys(event.payload, turnFinishKeys, "events_turn_shape_invalid");
    requireExactValue(event.payload.turnIndex, turnIndex, "events_turn_order_invalid");
    requireExactValue(
      event.payload.finishReason,
      turnIndex === 2 ? "stop" : "tool_calls",
      "events_turn_order_invalid",
    );
    requireExactValue(event.payload.turnCostUSD, 0, "events_turn_order_invalid");
    requireExactValue(event.payload.turnDurationMs, 120, "events_turn_order_invalid");
    requireExactValue(
      event.payload.toolCallsCount,
      turnIndex === 2 ? 0 : 1,
      "events_turn_order_invalid",
    );
    requireExactValue(event.payload.toolErrorsCount, 0, "events_turn_order_invalid");
  }
}

function validateToolPair(
  dispatch: DiagnosticEvent | undefined,
  finish: DiagnosticEvent | undefined,
  expectedName: "list_directory" | "write_file",
  expectedTurn: number,
  runId: string,
): void {
  requireCondition(dispatch !== undefined && finish !== undefined, "events_tool_order_invalid");
  requireExactKeys(
    dispatch.payload,
    ["turnIndex", "toolCallId", "toolName", "arguments"],
    "events_tool_shape_invalid",
  );
  requireExactKeys(
    finish.payload,
    ["turnIndex", "toolCallId", "toolName", "isError", "durationMs"],
    "events_tool_shape_invalid",
  );
  requireExactValue(dispatch.payload.turnIndex, expectedTurn, "events_tool_order_invalid");
  requireExactValue(finish.payload.turnIndex, expectedTurn, "events_tool_order_invalid");
  requireExactValue(dispatch.payload.toolName, expectedName, "events_tool_order_invalid");
  requireExactValue(finish.payload.toolName, expectedName, "events_tool_order_invalid");
  const toolCallId = requireString(dispatch.payload.toolCallId, "events_tool_order_invalid");
  requireCondition(
    toolCallId.startsWith(`${runId}-turn-${expectedTurn}`),
    "events_tool_order_invalid",
  );
  requireExactValue(finish.payload.toolCallId, toolCallId, "events_tool_order_invalid");
  requireExactValue(finish.payload.isError, false, "events_tool_order_invalid");
  requireCondition(
    typeof finish.payload.durationMs === "number" && finish.payload.durationMs >= 0,
    "events_tool_order_invalid",
  );
}

export function validateDiagnosticEvents(path: string, artifacts: DiagnosticArtifacts): void {
  const content = readFileSync(path, "utf8");
  const rawLines = content.split("\n");
  if (rawLines.at(-1) === "") rawLines.pop();
  requireCondition(
    rawLines.length === expectedEventTypes.length &&
      rawLines.every((line) => line.trim().length > 0),
    "events_count_invalid",
  );
  const events: DiagnosticEvent[] = [];
  let previousTimestamp = -1n;
  for (const [index, line] of rawLines.entries()) {
    const record = parseEventLine(line);
    requireExactKeys(record, outerEventKeys, "events_shape_invalid");
    requireNoDiagnosticClaims(record, "events_claim_present");
    requireExactValue(record.runId, artifacts.identity.runId, "events_run_identity_invalid");
    const sequenceNumber = requireInteger(record.sequenceNumber, "events_sequence_invalid");
    requireExactValue(sequenceNumber, index + 1, "events_sequence_invalid");
    const timestampUs = requireString(record.timestampUs, "events_timestamp_invalid");
    requireCondition(/^[1-9][0-9]{15}$/.test(timestampUs), "events_timestamp_invalid");
    const timestamp = BigInt(timestampUs);
    requireCondition(timestamp >= previousTimestamp, "events_timestamp_order_invalid");
    previousTimestamp = timestamp;
    const type = requireString(record.type, "events_type_invalid");
    requireExactValue(type, expectedEventTypes[index], "events_type_invalid");
    const payload = requireRecord(record.payload, "events_payload_invalid");
    events.push({ sequenceNumber, timestampUs, type, payload });
  }
  const first = events[0];
  const last = events.at(-1);
  requireCondition(first !== undefined && last !== undefined, "events_terminal_missing");
  requireExactValue(first.payload.runId, artifacts.identity.runId, "events_start_identity_invalid");
  requireExactKeys(
    first.payload,
    ["runId", "scenarioId", "modelId", "skillIds", "limits"],
    "events_start_shape_invalid",
  );
  requireExactValue(
    first.payload.scenarioId,
    artifacts.identity.scenarioId,
    "events_start_identity_invalid",
  );
  requireExactValue(
    first.payload.modelId,
    artifacts.identity.modelId,
    "events_start_identity_invalid",
  );
  requireEqualStringArrays(
    first.payload.skillIds,
    [artifacts.identity.skillId],
    "events_start_identity_invalid",
  );
  const limits = requireRecord(first.payload.limits, "events_start_limits_invalid");
  requireExactKeys(
    limits,
    [
      "maxTurns",
      "maxWallClockTimeMs",
      "maxCostUSD",
      "maxConsecutiveToolFailures",
      "toolTimeoutMs",
      "maxOutputSizeBytes",
    ],
    "events_start_limits_invalid",
  );
  requireExactValue(limits.maxTurns, 10, "events_start_limits_invalid");
  requireExactValue(limits.maxWallClockTimeMs, 120000, "events_start_limits_invalid");
  requireExactValue(limits.maxCostUSD, 0.5, "events_start_limits_invalid");
  requireExactValue(limits.maxConsecutiveToolFailures, 3, "events_start_limits_invalid");
  requireExactValue(limits.toolTimeoutMs, 30000, "events_start_limits_invalid");
  requireExactValue(limits.maxOutputSizeBytes, 1048576, "events_start_limits_invalid");
  validateTurnEvents(events);
  validateToolPair(events[2], events[3], "list_directory", 0, artifacts.identity.runId);
  validateToolPair(events[6], events[7], "write_file", 1, artifacts.identity.runId);
  const listArguments = requireRecord(
    events[2]?.payload.arguments,
    "events_list_arguments_invalid",
  );
  requireExactKeys(listArguments, ["path", "max_depth"], "events_list_arguments_invalid");
  requireExactValue(listArguments.path, ".", "events_list_arguments_invalid");
  requireExactValue(listArguments.max_depth, 2, "events_list_arguments_invalid");
  const writeArguments = requireRecord(
    events[6]?.payload.arguments,
    "events_write_arguments_invalid",
  );
  requireExactKeys(writeArguments, ["path", "content"], "events_write_arguments_invalid");
  requireExactValue(writeArguments.path, "benchmark-output.txt", "events_write_arguments_invalid");
  requireExactValue(
    writeArguments.content,
    "fake benchmark artifact\n",
    "events_write_arguments_invalid",
  );
  requireExactValue(last.payload.runId, artifacts.identity.runId, "events_finish_identity_invalid");
  requireExactKeys(
    last.payload,
    ["runId", "terminationReason", "totalDurationMs", "totalCostUSD", "totalTurns", "completed"],
    "events_finish_shape_invalid",
  );
  requireExactValue(last.payload.terminationReason, "success", "events_finish_status_invalid");
  requireExactValue(last.payload.completed, true, "events_finish_status_invalid");
  requireExactValue(last.payload.totalCostUSD, 0, "events_finish_status_invalid");
  requireExactValue(last.payload.totalTurns, 3, "events_finish_status_invalid");
  requireExactValue(
    last.payload.totalTurns,
    artifacts.result.totalTurns,
    "events_artifact_terminal_mismatch",
  );
  requireExactValue(artifacts.result.toolErrorCount, 0, "events_artifact_terminal_mismatch");
  const terminalDuration = requireFiniteNumber(
    last.payload.totalDurationMs,
    "events_finish_status_invalid",
  );
  const resultDuration = requireFiniteNumber(
    artifacts.result.totalDurationMs,
    "events_artifact_terminal_mismatch",
  );
  requireCondition(
    terminalDuration >= 0 && Math.abs(terminalDuration - resultDuration) < 0.01,
    "events_artifact_terminal_mismatch",
  );
  const startedUs = BigInt(Date.parse(artifacts.startedAt)) * 1000n;
  const completedUs = BigInt(Date.parse(artifacts.completedAt) + 1) * 1000n - 1n;
  requireCondition(
    BigInt(first.timestampUs) >= startedUs && BigInt(last.timestampUs) <= completedUs,
    "events_artifact_timestamp_mismatch",
  );
}

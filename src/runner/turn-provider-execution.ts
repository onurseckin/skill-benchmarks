import { raceWithCancellation, resolveAbortReason } from "../shared/cancellation.js";
import type {
  AgentMessage,
  GenerateOptions,
  LLMProviderAdapter,
  ModelTurnResponse,
  StreamCollector,
  TokenUsage,
  ToolCallRequest,
  ToolDefinition,
} from "./types.js";

export interface ProviderTurnExecutionInput {
  readonly provider: LLMProviderAdapter;
  readonly messages: ReadonlyArray<AgentMessage>;
  readonly tools: ReadonlyArray<ToolDefinition>;
  readonly options: GenerateOptions;
  readonly signal: AbortSignal;
  readonly collector?: StreamCollector;
}

interface MutableToolCall {
  id: string;
  name: string;
  argsText: string;
}

const emptyUsage: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  totalTokens: 0,
};

export async function executeProviderTurn(
  input: ProviderTurnExecutionInput,
): Promise<ModelTurnResponse> {
  throwIfTurnAborted(input.signal);
  if (input.collector?.onToken === undefined) {
    const response = await raceWithCancellation(
      input.provider.generateTurn(input.messages, input.tools, input.options),
      input.signal,
      "turn",
    );
    throwIfTurnAborted(input.signal);
    return response;
  }
  return await consumeProviderStream(input);
}

async function consumeProviderStream(
  input: ProviderTurnExecutionInput,
): Promise<ModelTurnResponse> {
  const startedAtMs = performance.now();
  const iterator = input.provider
    .generateStream(input.messages, input.tools, input.options)
    [Symbol.asyncIterator]();
  const toolCallMap = new Map<number, MutableToolCall>();
  let text = "";
  let finishReason: ModelTurnResponse["finishReason"] = "stop";
  let usage = emptyUsage;
  let firstTokenTimeMs = 0;

  while (true) {
    const result = await raceWithCancellation(iterator.next(), input.signal, "turn");
    throwIfTurnAborted(input.signal);
    if (result.done) break;
    const chunk = result.value;
    if (chunk.textDelta !== undefined && chunk.textDelta.length > 0) {
      if (firstTokenTimeMs === 0) firstTokenTimeMs = performance.now() - startedAtMs;
      text += chunk.textDelta;
      input.collector?.onToken?.(chunk.textDelta);
    }
    if (chunk.toolCallDeltas !== undefined) {
      for (const delta of chunk.toolCallDeltas) {
        const current = toolCallMap.get(delta.index) ?? {
          id: delta.id ?? `call_${delta.index}`,
          name: delta.name ?? "",
          argsText: "",
        };
        if (delta.id !== undefined && delta.id.length > 0) current.id = delta.id;
        if (delta.name !== undefined && delta.name.length > 0) current.name = delta.name;
        if (delta.argumentsDelta !== undefined) current.argsText += delta.argumentsDelta;
        toolCallMap.set(delta.index, current);
      }
    }
    if (chunk.finishReason !== undefined) finishReason = chunk.finishReason;
    if (chunk.usage !== undefined) usage = chunk.usage;
  }

  const totalTurnDurationMs = performance.now() - startedAtMs;
  return {
    text,
    toolCalls: Array.from(toolCallMap.values(), createToolCall),
    finishReason,
    usage,
    timeToFirstTokenMs: firstTokenTimeMs > 0 ? firstTokenTimeMs : totalTurnDurationMs,
    totalTurnDurationMs,
  };
}

function createToolCall(value: MutableToolCall): ToolCallRequest {
  let parsedArguments: Record<string, unknown> = {};
  try {
    if (value.argsText.trim().length > 0) {
      parsedArguments = JSON.parse(value.argsText) as Record<string, unknown>;
    }
  } catch {
    parsedArguments = {};
  }
  return {
    id: value.id,
    name: value.name,
    arguments: parsedArguments,
    rawArguments: value.argsText,
  };
}

function throwIfTurnAborted(signal: AbortSignal): void {
  if (signal.aborted) throw resolveAbortReason(signal, "turn");
}

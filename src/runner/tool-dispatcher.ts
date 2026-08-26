import type {
  AgentToolContext,
  ExecutionLimits,
  StandardTool,
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionRecord,
} from "./types.js";
import {
  createCancellationScope,
  ExecutionAbortedError,
  ExecutionTimeoutError,
  raceWithCancellation,
} from "../shared/cancellation.js";
import { STANDARD_TOOLS } from "./tool-definitions.js";
import {
  handleEditFileContent,
  handleFindByName,
  handleGrepSearch,
  handleListDirectory,
  handleReadFile,
  handleRunCommand,
  handleWriteFile,
  resolveSafePath,
  truncateOutput,
  type ToolHandlerResult,
} from "./tool-handlers.js";
import { resolveToolTimeoutMs } from "./local-command-execution.js";

export { STANDARD_TOOLS, resolveSafePath, truncateOutput };

export function toToolCallResult(record: ToolExecutionRecord): ToolCallResult {
  return {
    toolCallId: record.toolCallId,
    output: record.output,
    isError: record.isError,
    executionTimeMs: record.durationMs,
  };
}

export class StandardToolDispatcher {
  private readonly customTools: Map<string, StandardTool> = new Map();

  registerTool(tool: StandardTool): void {
    this.customTools.set(tool.definition.name, tool);
  }

  getToolDefinitions(allowedToolNames?: ReadonlyArray<string>): ReadonlyArray<ToolDefinition> {
    const customDefs = Array.from(this.customTools.values()).map((t) => t.definition);
    const combined = [...STANDARD_TOOLS, ...customDefs];
    if (allowedToolNames === undefined) return combined;
    const allowedSet = new Set(allowedToolNames);
    return combined.filter((def) => allowedSet.has(def.name));
  }

  hasTool(name: string): boolean {
    if (this.customTools.has(name)) return true;
    return STANDARD_TOOLS.some((t) => t.name === name);
  }

  async dispatch(
    toolCall: ToolCallRequest,
    context: AgentToolContext,
    limits?: ExecutionLimits,
  ): Promise<ToolExecutionRecord> {
    const startTime = performance.now();
    const maxBytes = limits?.maxOutputSizeBytes ?? 5242880;
    const timeoutMs = resolveToolTimeoutMs(limits?.toolTimeoutMs);
    const scope = createCancellationScope({
      scope: "tool",
      callerSignal: context.signal,
      timeoutMs,
    });

    let result: ToolHandlerResult;
    try {
      scope.throwIfAborted();
      result = await raceWithCancellation(
        this.executeCall(toolCall, { ...context, signal: scope.signal }, limits),
        scope.signal,
        "tool",
      );
      scope.throwIfAborted();
    } catch (error) {
      if (
        error instanceof ExecutionAbortedError ||
        (error instanceof ExecutionTimeoutError && error.scope !== "tool")
      ) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      result = {
        output: `Error executing tool '${toolCall.name}': ${msg}`,
        isError: true,
        stderr: msg,
      };
    } finally {
      scope.dispose();
    }

    const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
    const truncated = truncateOutput(result.output, maxBytes);

    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
      output: truncated.text,
      isError: result.isError,
      durationMs,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  private async executeCall(
    toolCall: ToolCallRequest,
    context: AgentToolContext,
    limits?: ExecutionLimits,
  ): Promise<ToolHandlerResult> {
    const custom = this.customTools.get(toolCall.name);
    if (custom !== undefined) {
      const rawRes = await custom.execute(toolCall.arguments, context);
      const outStr = typeof rawRes === "string" ? rawRes : JSON.stringify(rawRes, null, 2);
      return { output: outStr, isError: false, stdout: outStr };
    }

    switch (toolCall.name) {
      case "run_command":
        return await handleRunCommand(toolCall.arguments, context, limits);
      case "read_file":
        return await handleReadFile(toolCall.arguments, context);
      case "write_file":
        return await handleWriteFile(toolCall.arguments, context);
      case "edit_file_content":
        return await handleEditFileContent(toolCall.arguments, context);
      case "list_directory":
        return await handleListDirectory(toolCall.arguments, context);
      case "grep_search":
        return await handleGrepSearch(toolCall.arguments, context);
      case "find_by_name":
        return await handleFindByName(toolCall.arguments, context);
      default:
        return { output: `Tool '${toolCall.name}' is not recognized or supported.`, isError: true };
    }
  }
}

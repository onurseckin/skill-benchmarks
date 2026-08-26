import type {
  AgentToolContext,
  GenerateOptions,
  ModelTurnResponse,
  RunTerminationReason,
  ScenarioResult,
  ScenarioRunConfig,
  StreamCollector,
  TokenUsage,
  ToolCallRequest,
  ToolExecutionRecord,
  TurnTelemetry,
} from "./types.js";
import { AgentContextManager } from "./context-manager.js";
import { StandardToolDispatcher } from "./tool-dispatcher.js";
import { EventScribe, createTelemetryEvent } from "../infrastructure/telemetry/event-scribe.js";
import { resolveArtifactPaths } from "../infrastructure/workspace/storage.js";

export { createTelemetryEvent };

export class ScenarioRunnerEngine {
  private readonly defaultToolDispatcher: StandardToolDispatcher;

  constructor(toolDispatcher?: StandardToolDispatcher) {
    this.defaultToolDispatcher = toolDispatcher ?? new StandardToolDispatcher();
  }

  public getToolDispatcher(): StandardToolDispatcher {
    return this.defaultToolDispatcher;
  }

  public async run(
    config: ScenarioRunConfig,
    collector?: StreamCollector,
  ): Promise<ScenarioResult> {
    const startedAt = new Date().toISOString();
    const startTimeMs = performance.now();
    const basePath =
      config.artifactOutputDir ?? config.workspace?.rootPath ?? ".benchmarks/runs/" + config.runId;
    const artifactPaths = resolveArtifactPaths(basePath);
    const scribe = new EventScribe({
      runId: config.runId,
      outputDir: artifactPaths.runDir,
      artifactLayout: config.artifactLayout,
    });

    scribe.emit("run:start", {
      runId: config.runId,
      scenarioId: config.scenarioId,
      modelId: config.modelId,
      skillIds: config.skillIds,
      limits: config.limits,
    });

    const contextManager = new AgentContextManager();
    contextManager.initialize(config.prompt, config.skillIds, config.systemPrompt);
    contextManager.registerTools(this.defaultToolDispatcher.getToolDefinitions());

    let turnIndex = 0;
    const turnHistory: TurnTelemetry[] = [];
    const toolHistory: ToolExecutionRecord[] = [];
    let totalUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
    };
    let totalCostUSD = 0;
    let consecutiveToolErrors = 0;
    let terminationReason: RunTerminationReason = "success";
    let finalOutput = "";
    let errorMessage: string | undefined;

    while (turnIndex < config.limits.maxTurns) {
      if (performance.now() - startTimeMs > config.limits.maxWallClockTimeMs) {
        terminationReason = "timeout";
        break;
      }
      if (totalCostUSD >= config.limits.maxCostUSD) {
        terminationReason = "budget_exceeded";
        break;
      }
      if (consecutiveToolErrors >= config.limits.maxConsecutiveToolFailures) {
        terminationReason = "tool_error_loop";
        break;
      }

      scribe.emit("turn:start", {
        turnIndex,
        messageCount: contextManager.getMessageCount(),
      });

      const messages = contextManager.getMessages();
      const tools = this.defaultToolDispatcher.getToolDefinitions();
      const options: GenerateOptions = {
        temperature: config.temperature ?? 0.0,
        thinkingEffortLevel: config.thinkingLevel,
        thinkingBudgetTokens: config.thinkingBudget,
        reasoningEffort: config.reasoningEffort,
      };

      let turnResponse: ModelTurnResponse;
      const turnStartTimeMs = performance.now();

      try {
        if (
          collector?.onToken !== undefined &&
          typeof config.provider.generateStream === "function"
        ) {
          let accumulatedText = "";
          const toolCallMap = new Map<number, { id: string; name: string; argsText: string }>();
          let finishReason: ModelTurnResponse["finishReason"] = "stop";
          let streamUsage: TokenUsage = {
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            totalTokens: 0,
          };
          let firstTokenTimeMs = 0;

          for await (const chunk of config.provider.generateStream(messages, tools, options)) {
            if (chunk.textDelta !== undefined && chunk.textDelta.length > 0) {
              if (firstTokenTimeMs === 0) firstTokenTimeMs = performance.now() - turnStartTimeMs;
              accumulatedText += chunk.textDelta;
              collector.onToken(chunk.textDelta);
            }
            if (chunk.toolCallDeltas !== undefined) {
              for (const delta of chunk.toolCallDeltas) {
                const existing = toolCallMap.get(delta.index) ?? {
                  id: delta.id ?? `call_${delta.index}`,
                  name: delta.name ?? "",
                  argsText: "",
                };
                if (delta.id !== undefined && delta.id.length > 0) existing.id = delta.id;
                if (delta.name !== undefined && delta.name.length > 0) existing.name = delta.name;
                if (delta.argumentsDelta !== undefined) existing.argsText += delta.argumentsDelta;
                toolCallMap.set(delta.index, existing);
              }
            }
            if (chunk.finishReason !== undefined) finishReason = chunk.finishReason;
            if (chunk.usage !== undefined) streamUsage = chunk.usage;
          }

          const toolCalls: ToolCallRequest[] = [];
          for (const [, tc] of toolCallMap) {
            let parsedArgs: Record<string, unknown> = {};
            try {
              if (tc.argsText.trim().length > 0)
                parsedArgs = JSON.parse(tc.argsText) as Record<string, unknown>;
            } catch {
              parsedArgs = {};
            }
            toolCalls.push({
              id: tc.id,
              name: tc.name,
              arguments: parsedArgs,
              rawArguments: tc.argsText,
            });
          }

          const totalTurnDurationMs = performance.now() - turnStartTimeMs;
          turnResponse = {
            text: accumulatedText,
            toolCalls,
            finishReason,
            usage: streamUsage,
            timeToFirstTokenMs: firstTokenTimeMs > 0 ? firstTokenTimeMs : totalTurnDurationMs,
            totalTurnDurationMs,
          };
        } else {
          turnResponse = await config.provider.generateTurn(messages, tools, options);
          if (collector?.onToken !== undefined && turnResponse.text.length > 0) {
            collector.onToken(turnResponse.text);
          }
        }
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        errorMessage = errorText;
        terminationReason = "error";
        scribe.emit("turn:error", { turnIndex, error: errorText });
        break;
      }

      const turnCostUSD = config.provider.calculateCostUSD(turnResponse.usage);
      totalCostUSD += turnCostUSD;
      totalUsage = {
        inputTokens: totalUsage.inputTokens + turnResponse.usage.inputTokens,
        outputTokens: totalUsage.outputTokens + turnResponse.usage.outputTokens,
        cacheCreationInputTokens:
          totalUsage.cacheCreationInputTokens + turnResponse.usage.cacheCreationInputTokens,
        cacheReadInputTokens:
          totalUsage.cacheReadInputTokens + turnResponse.usage.cacheReadInputTokens,
        totalTokens: totalUsage.totalTokens + turnResponse.usage.totalTokens,
      };

      contextManager.addAssistantTurn(turnResponse.text, turnResponse.toolCalls);

      let turnToolExecutionDurationMs = 0;
      let turnToolErrorsCount = 0;
      let shouldStopOnToolFailure = false;

      if (turnResponse.toolCalls.length > 0) {
        const toolContext: AgentToolContext = {
          workspace: config.workspace,
          container: config.container,
          runId: config.runId,
          scenarioId: config.scenarioId,
        };

        for (const toolCall of turnResponse.toolCalls) {
          if (collector?.onToolStart !== undefined) {
            collector.onToolStart(toolCall);
          }
          scribe.emit("tool:dispatch", {
            turnIndex,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            arguments: toolCall.arguments,
          });

          const record = await this.defaultToolDispatcher.dispatch(
            toolCall,
            toolContext,
            config.limits,
          );
          toolHistory.push(record);
          turnToolExecutionDurationMs += record.durationMs;
          if (record.isError) turnToolErrorsCount += 1;

          scribe.emit("tool:finish", {
            turnIndex,
            toolCallId: record.toolCallId,
            toolName: record.toolName,
            isError: record.isError,
            durationMs: record.durationMs,
            exitCode: record.exitCode,
          });

          if (collector?.onToolEnd !== undefined) {
            collector.onToolEnd(record);
          }

          contextManager.addToolResult(
            record.toolCallId,
            record.toolName,
            record.output,
            record.isError,
          );
        }

        if (turnToolErrorsCount === turnResponse.toolCalls.length) {
          consecutiveToolErrors += 1;
        } else {
          consecutiveToolErrors = 0;
        }

        if (config.limits.stopOnToolFailures === true && turnToolErrorsCount > 0) {
          terminationReason = "tool_error_loop";
          shouldStopOnToolFailure = true;
        }
      } else {
        finalOutput = turnResponse.text;
        terminationReason = "success";
      }

      const turnTelemetry: TurnTelemetry = {
        turnIndex,
        promptTokens: turnResponse.usage.inputTokens,
        completionTokens: turnResponse.usage.outputTokens,
        cacheReadTokens: turnResponse.usage.cacheReadInputTokens,
        cacheWriteTokens: turnResponse.usage.cacheCreationInputTokens,
        turnCostUSD,
        timeToFirstTokenMs: turnResponse.timeToFirstTokenMs,
        turnDurationMs: turnResponse.totalTurnDurationMs,
        toolExecutionDurationMs: turnToolExecutionDurationMs,
        toolCallsCount: turnResponse.toolCalls.length,
        toolErrorsCount: turnToolErrorsCount,
        finishReason: turnResponse.finishReason,
      };

      turnHistory.push(turnTelemetry);

      scribe.emit("turn:finish", {
        turnIndex,
        turnCostUSD,
        turnDurationMs: turnResponse.totalTurnDurationMs,
        toolCallsCount: turnResponse.toolCalls.length,
        toolErrorsCount: turnToolErrorsCount,
        finishReason: turnResponse.finishReason,
      });

      if (collector?.onTurnComplete !== undefined) {
        collector.onTurnComplete(turnTelemetry);
      }

      turnIndex += 1;

      if (turnResponse.toolCalls.length === 0 || shouldStopOnToolFailure) {
        break;
      }
    }

    if (
      turnIndex >= config.limits.maxTurns &&
      terminationReason === "success" &&
      finalOutput.length === 0
    ) {
      terminationReason = "max_turns";
    }

    const totalDurationMs = performance.now() - startTimeMs;
    const finishedAt = new Date().toISOString();
    const completed = terminationReason === "success";

    scribe.emit("run:finish", {
      runId: config.runId,
      terminationReason,
      totalDurationMs,
      totalCostUSD,
      totalTurns: turnIndex,
      completed,
    });

    await scribe.close();

    const result: ScenarioResult = {
      runId: config.runId,
      scenarioId: config.scenarioId,
      skillIds: config.skillIds,
      modelId: config.modelId,
      executionMode: config.provider.executionMode ?? "live",
      simulated: config.provider.executionMode === "fake",
      thinkingLevel: config.thinkingLevel,
      thinkingBudget: config.thinkingBudget,
      terminationReason,
      completed,
      turns: turnIndex,
      turnHistory,
      toolHistory,
      messages: contextManager.getMessages(),
      finalOutput,
      totalDurationMs: Math.round(totalDurationMs * 100) / 100,
      totalTokens: totalUsage,
      totalCostUSD: Math.round(totalCostUSD * 1000000) / 1000000,
      consecutiveToolErrors,
      startedAt,
      finishedAt,
      errorMessage,
    };

    return result;
  }
}

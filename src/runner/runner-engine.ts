import { EventScribe, createTelemetryEvent } from "../infrastructure/telemetry/event-scribe.js";
import { resolveArtifactPaths } from "../infrastructure/workspace/storage.js";
import { ProviderRateLimitError } from "../providers/types.js";
import {
  createCancellationScope,
  ExecutionAbortedError,
  ExecutionTimeoutError,
  type CancellationScope,
} from "../shared/cancellation.js";
import { AgentContextManager } from "./context-manager.js";
import { StandardToolDispatcher } from "./tool-dispatcher.js";
import { executeProviderTurn } from "./turn-provider-execution.js";
import type {
  AgentToolContext,
  GenerateOptions,
  RunTerminationReason,
  ScenarioResult,
  ScenarioRunConfig,
  StreamCollector,
  TokenUsage,
  ToolExecutionRecord,
  TurnTelemetry,
} from "./types.js";

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
    const scenarioScope = createCancellationScope({
      scope: "scenario",
      callerSignal: config.signal,
      timeoutMs: config.limits.maxWallClockTimeMs,
    });
    try {
      return await this.runWithinScenario(config, scenarioScope, collector);
    } finally {
      scenarioScope.dispose();
    }
  }

  private async runWithinScenario(
    config: ScenarioRunConfig,
    scenarioScope: CancellationScope,
    collector?: StreamCollector,
  ): Promise<ScenarioResult> {
    const startedAt = new Date().toISOString();
    const startTimeMs = performance.now();
    const basePath =
      config.artifactOutputDir ?? config.workspace?.rootPath ?? `.benchmarks/runs/${config.runId}`;
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

    try {
      const contextManager = new AgentContextManager();
      contextManager.initialize(config.prompt, config.skillIds, config.systemPrompt);
      contextManager.registerTools(this.defaultToolDispatcher.getToolDefinitions());

      let turnIndex = 0;
      const turnHistory: TurnTelemetry[] = [];
      const toolHistory: ToolExecutionRecord[] = [];
      let totalUsage = createEmptyUsage();
      let totalCostUSD = 0;
      let consecutiveToolErrors = 0;
      let terminationReason: RunTerminationReason = "success";
      let finalOutput = "";
      let errorMessage: string | undefined;

      while (turnIndex < config.limits.maxTurns) {
        const preflightFailure = captureCancellationFailure(scenarioScope);
        if (preflightFailure !== undefined) {
          terminationReason = preflightFailure.reason;
          errorMessage = preflightFailure.message;
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

        const remainingScenarioMs = Math.max(
          0,
          (scenarioScope.deadlineAtMs ?? Date.now()) - Date.now(),
        );
        const turnScope = createCancellationScope({
          scope: "turn",
          callerSignal: scenarioScope.signal,
          timeoutMs: Math.min(
            remainingScenarioMs,
            config.limits.turnTimeoutMs ?? remainingScenarioMs,
          ),
        });
        scribe.emit("turn:start", {
          turnIndex,
          messageCount: contextManager.getMessageCount(),
        });

        let shouldStopOnToolFailure = false;
        try {
          const options: GenerateOptions = {
            temperature: config.temperature ?? 0,
            thinkingEffortLevel: config.thinkingLevel,
            thinkingBudgetTokens: config.thinkingBudget,
            reasoningEffort: config.reasoningEffort,
            signal: turnScope.signal,
          };
          const turnResponse = await executeProviderTurn({
            provider: config.provider,
            messages: contextManager.getMessages(),
            tools: this.defaultToolDispatcher.getToolDefinitions(),
            options,
            signal: turnScope.signal,
            collector,
          });
          turnScope.throwIfAborted();

          const turnCostUSD = config.provider.calculateCostUSD(turnResponse.usage);
          totalCostUSD += turnCostUSD;
          totalUsage = addUsage(totalUsage, turnResponse.usage);
          contextManager.addAssistantTurn(turnResponse.text, turnResponse.toolCalls);

          let toolExecutionDurationMs = 0;
          let toolErrorsCount = 0;
          if (turnResponse.toolCalls.length > 0) {
            const toolContext: AgentToolContext = {
              workspace: config.workspace,
              container: config.container,
              signal: turnScope.signal,
              runId: config.runId,
              scenarioId: config.scenarioId,
            };
            for (const toolCall of turnResponse.toolCalls) {
              turnScope.throwIfAborted();
              collector?.onToolStart?.(toolCall);
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
              turnScope.throwIfAborted();
              toolHistory.push(record);
              toolExecutionDurationMs += record.durationMs;
              if (record.isError) toolErrorsCount += 1;
              scribe.emit("tool:finish", {
                turnIndex,
                toolCallId: record.toolCallId,
                toolName: record.toolName,
                isError: record.isError,
                durationMs: record.durationMs,
                exitCode: record.exitCode,
              });
              collector?.onToolEnd?.(record);
              contextManager.addToolResult(
                record.toolCallId,
                record.toolName,
                record.output,
                record.isError,
              );
            }
            consecutiveToolErrors =
              toolErrorsCount === turnResponse.toolCalls.length ? consecutiveToolErrors + 1 : 0;
            if (config.limits.stopOnToolFailures === true && toolErrorsCount > 0) {
              terminationReason = "tool_error_loop";
              shouldStopOnToolFailure = true;
            }
          } else {
            finalOutput = turnResponse.text;
            terminationReason = "success";
          }

          const telemetry: TurnTelemetry = {
            turnIndex,
            promptTokens: turnResponse.usage.inputTokens,
            completionTokens: turnResponse.usage.outputTokens,
            cacheReadTokens: turnResponse.usage.cacheReadInputTokens,
            cacheWriteTokens: turnResponse.usage.cacheCreationInputTokens,
            turnCostUSD,
            timeToFirstTokenMs: turnResponse.timeToFirstTokenMs,
            turnDurationMs: turnResponse.totalTurnDurationMs,
            toolExecutionDurationMs,
            toolCallsCount: turnResponse.toolCalls.length,
            toolErrorsCount,
            finishReason: turnResponse.finishReason,
          };
          turnHistory.push(telemetry);
          scribe.emit("turn:finish", {
            turnIndex,
            turnCostUSD,
            turnDurationMs: turnResponse.totalTurnDurationMs,
            toolCallsCount: turnResponse.toolCalls.length,
            toolErrorsCount,
            finishReason: turnResponse.finishReason,
          });
          collector?.onTurnComplete?.(telemetry);
          turnIndex += 1;
          if (turnResponse.toolCalls.length === 0 || shouldStopOnToolFailure) break;
        } catch (error) {
          if (error instanceof ProviderRateLimitError) {
            scribe.emit("turn:error", { turnIndex, error: error.message });
            throw error;
          }
          const failure = classifyTurnFailure(error);
          terminationReason = failure.reason;
          errorMessage = failure.message;
          scribe.emit("turn:error", { turnIndex, error: failure.message });
          break;
        } finally {
          turnScope.dispose();
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
      const completed = terminationReason === "success";
      const finishEvent = scribe.emit("run:finish", {
        runId: config.runId,
        terminationReason,
        totalDurationMs,
        totalCostUSD,
        totalTurns: turnIndex,
        completed,
      });
      const finishedAt = new Date(Number(BigInt(finishEvent.timestampUs) / 1000n)).toISOString();
      return {
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
        totalCostUSD: Math.round(totalCostUSD * 1_000_000) / 1_000_000,
        consecutiveToolErrors,
        startedAt,
        finishedAt,
        errorMessage,
      };
    } finally {
      await scribe.close();
    }
  }
}

function createEmptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
  };
}

function addUsage(total: TokenUsage, turn: TokenUsage): TokenUsage {
  return {
    inputTokens: total.inputTokens + turn.inputTokens,
    outputTokens: total.outputTokens + turn.outputTokens,
    cacheCreationInputTokens: total.cacheCreationInputTokens + turn.cacheCreationInputTokens,
    cacheReadInputTokens: total.cacheReadInputTokens + turn.cacheReadInputTokens,
    totalTokens: total.totalTokens + turn.totalTokens,
  };
}

function captureCancellationFailure(scope: CancellationScope) {
  try {
    scope.throwIfAborted();
    return undefined;
  } catch (error) {
    return classifyTurnFailure(error);
  }
}

function classifyTurnFailure(error: unknown): {
  readonly reason: RunTerminationReason;
  readonly message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (
    error instanceof ExecutionTimeoutError ||
    (error instanceof Error && error.name === "ProviderTimeoutError")
  ) {
    return { reason: "timeout", message };
  }
  if (error instanceof ExecutionAbortedError) return { reason: "aborted", message };
  return { reason: "error", message };
}

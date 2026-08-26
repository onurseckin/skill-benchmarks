import {
  AgentMessage,
  CompletionChunk,
  FinishReason,
  GenerateOptions,
  LLMProviderAdapter,
  ModelTurnResponse,
  ProviderConfig,
  ProviderId,
  TokenUsage,
  ToolCallRequest,
  ToolDefinition,
} from "./types";

export class MockProviderAdapter implements LLMProviderAdapter {
  public readonly providerId: ProviderId;
  public readonly modelId: string;
  public readonly executionMode = "fake" as const;
  public readonly simulated = true;
  private readonly config: ProviderConfig;

  constructor(modelId?: string, config?: Partial<ProviderConfig>) {
    this.modelId = modelId !== undefined && modelId.length > 0 ? modelId : "mock-claude-3-7-sonnet";
    this.providerId = config?.providerId ?? "custom";
    this.config = {
      providerId: this.providerId,
      executionMode: "fake",
      runId: config?.runId ?? "mock-run",
      apiKey: config !== undefined && config.apiKey !== undefined ? config.apiKey : "mock-key",
      baseUrl:
        config !== undefined && config.baseUrl !== undefined
          ? config.baseUrl
          : "http://localhost:8080/mock",
      timeoutMs: config !== undefined && config.timeoutMs !== undefined ? config.timeoutMs : 30000,
      maxRetries: config !== undefined && config.maxRetries !== undefined ? config.maxRetries : 0,
      customHeaders: config !== undefined ? config.customHeaders : undefined,
      defaultModel: this.modelId,
    };
  }

  public calculateCostUSD(usage: TokenUsage): number {
    void usage;
    return 0;
  }

  public async *generateStream(
    messages: ReadonlyArray<AgentMessage>,
    tools: ReadonlyArray<ToolDefinition>,
    options: GenerateOptions,
  ): AsyncIterable<CompletionChunk> {
    const turn = await this.generateTurn(messages, tools, options);
    const text = turn.text;
    const chunkSize = 20;

    for (let i = 0; i < text.length; i += chunkSize) {
      const slice = text.slice(i, i + chunkSize);
      yield {
        textDelta: slice,
      };
    }

    for (const toolCall of turn.toolCalls) {
      yield {
        toolCallDeltas: [
          {
            index: 0,
            id: toolCall.id,
            name: toolCall.name,
            argumentsDelta: toolCall.rawArguments,
          },
        ],
      };
    }

    yield {
      finishReason: turn.finishReason,
      usage: turn.usage,
    };
  }

  public async generateTurn(
    messages: ReadonlyArray<AgentMessage>,
    tools: ReadonlyArray<ToolDefinition>,
    options: GenerateOptions,
  ): Promise<ModelTurnResponse> {
    const turnCount = messages.filter((m) => m.role === "assistant").length;
    const toolCalls: ToolCallRequest[] = [];
    let text = "";
    let finishReason: FinishReason = "stop";

    if (turnCount === 0) {
      toolCalls.push({
        id: `${this.config.runId}-turn-0`,
        name: "list_directory",
        arguments: { path: ".", max_depth: 2 },
        rawArguments: JSON.stringify({ path: ".", max_depth: 2 }),
      });
      text = "Inspecting the disposable benchmark workspace.";
      finishReason = "tool_calls";
    } else if (turnCount === 1) {
      toolCalls.push({
        id: `${this.config.runId}-turn-1`,
        name: "write_file",
        arguments: { path: "benchmark-output.txt", content: "fake benchmark artifact\n" },
        rawArguments: JSON.stringify({
          path: "benchmark-output.txt",
          content: "fake benchmark artifact\n",
        }),
      });
      text = "Writing the deterministic benchmark artifact.";
      finishReason = "tool_calls";
    } else {
      text = "Fake benchmark trajectory completed successfully.";
      finishReason = "stop";
    }

    const inputTokens = 250 + turnCount * 120;
    const outputTokens = text.length + toolCalls.length * 40;
    const reasoningTokens =
      options.thinkingBudgetTokens !== undefined && options.thinkingBudgetTokens > 0 ? 512 : 0;

    const usage: TokenUsage = {
      inputTokens,
      outputTokens: outputTokens + reasoningTokens,
      cacheCreationInputTokens: turnCount === 0 ? 100 : 0,
      cacheReadInputTokens: turnCount > 0 ? 200 : 0,
      totalTokens: inputTokens + outputTokens + reasoningTokens,
      reasoningOutputTokens: reasoningTokens > 0 ? reasoningTokens : undefined,
    };

    return {
      text,
      toolCalls,
      finishReason,
      usage,
      timeToFirstTokenMs: 45,
      totalTurnDurationMs: 120,
    };
  }
}

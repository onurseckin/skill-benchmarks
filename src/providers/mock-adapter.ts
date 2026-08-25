import { calculateTokenCostUSD } from "./pricing";
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
  public readonly providerId: ProviderId = "custom";
  public readonly modelId: string;
  private readonly config: ProviderConfig;

  constructor(modelId?: string, config?: Partial<ProviderConfig>) {
    this.modelId = modelId !== undefined && modelId.length > 0 ? modelId : "mock-claude-3-7-sonnet";
    this.config = {
      providerId: "custom",
      apiKey: config !== undefined && config.apiKey !== undefined ? config.apiKey : "mock-key",
      baseUrl: config !== undefined && config.baseUrl !== undefined ? config.baseUrl : "http://localhost:8080/mock",
      timeoutMs: config !== undefined && config.timeoutMs !== undefined ? config.timeoutMs : 30000,
      maxRetries: config !== undefined && config.maxRetries !== undefined ? config.maxRetries : 0,
      customHeaders: config !== undefined ? config.customHeaders : undefined,
      defaultModel: this.modelId,
    };
  }

  public calculateCostUSD(usage: TokenUsage): number {
    return calculateTokenCostUSD(this.modelId, usage);
  }

  public async *generateStream(
    messages: ReadonlyArray<AgentMessage>,
    tools: ReadonlyArray<ToolDefinition>,
    options: GenerateOptions
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

    yield {
      finishReason: turn.finishReason,
      usage: turn.usage,
    };
  }

  public async generateTurn(
    messages: ReadonlyArray<AgentMessage>,
    tools: ReadonlyArray<ToolDefinition>,
    options: GenerateOptions
  ): Promise<ModelTurnResponse> {
    const turnCount = messages.filter((m) => m.role === "assistant").length;
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user" || m.role === "tool");
    const lastContent = typeof lastUserMessage?.content === "string" ? lastUserMessage.content : "";

    const toolCalls: ToolCallRequest[] = [];
    let text = "";
    let finishReason: FinishReason = "stop";

    if (tools.length > 0 && turnCount === 0) {
      const execTool = tools.find((t) => t.name.includes("exec") || t.name.includes("bash") || t.name.includes("run")) ?? tools[0];
      if (execTool !== undefined) {
        toolCalls.push({
          id: `call_${Math.random().toString(36).substring(2, 9)}`,
          name: execTool.name,
          arguments: { command: "git status" },
          rawArguments: JSON.stringify({ command: "git status" }),
        });
        text = "Inspecting workspace state and checking available file fixtures.";
        finishReason = "tool_calls";
      }
    } else if (tools.length > 0 && turnCount === 1) {
      const writeTool = tools.find((t) => t.name.includes("write") || t.name.includes("edit") || t.name.includes("replace")) ?? tools[0];
      if (writeTool !== undefined) {
        toolCalls.push({
          id: `call_${Math.random().toString(36).substring(2, 9)}`,
          name: writeTool.name,
          arguments: { targetFile: "src/main.ts", content: "export const initialized = true;" },
          rawArguments: JSON.stringify({ targetFile: "src/main.ts", content: "export const initialized = true;" }),
        });
        text = "Applying verified code modifications to satisfy benchmark requirements.";
        finishReason = "tool_calls";
      }
    } else {
      text = `Task completed successfully. All requirements and invariant checks verified. Output summary: ${lastContent.slice(0, 100)}`;
      finishReason = "stop";
    }

    const inputTokens = 250 + turnCount * 120;
    const outputTokens = text.length + toolCalls.length * 40;
    const reasoningTokens = options.thinkingBudgetTokens !== undefined && options.thinkingBudgetTokens > 0 ? 512 : 0;

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

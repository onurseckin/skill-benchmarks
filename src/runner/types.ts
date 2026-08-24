import type {
  IContainerInstance,
  IContainerPoolManager,
} from "../infrastructure/container/types.js";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export type AgentMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string;
      readonly toolCalls?: ReadonlyArray<ToolCallRequest>;
    }
  | {
      readonly role: "tool";
      readonly toolCallId: string;
      readonly name: string;
      readonly content: string;
      readonly isError: boolean;
    };

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly rawArguments: string;
}

export interface ToolCallResult {
  readonly toolCallId: string;
  readonly output: string;
  readonly isError: boolean;
  readonly executionTimeMs: number;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly totalTokens: number;
}

export interface DetailedTokenTelemetry {
  readonly uncachedInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly totalInputTokens: number;
  readonly completionOutputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalOutputTokens: number;
  readonly grandTotalTokens: number;
}

export interface CompletionChunk {
  readonly textDelta?: string;
  readonly toolCallDeltas?: ReadonlyArray<{
    readonly index: number;
    readonly id?: string;
    readonly name?: string;
    readonly argumentsDelta?: string;
  }>;
  readonly finishReason?:
    | "stop"
    | "tool_calls"
    | "length"
    | "content_filter"
    | "error";
  readonly usage?: TokenUsage;
}

export interface ModelTurnResponse {
  readonly text: string;
  readonly toolCalls: ReadonlyArray<ToolCallRequest>;
  readonly finishReason:
    | "stop"
    | "tool_calls"
    | "length"
    | "content_filter"
    | "error";
  readonly usage: TokenUsage;
  readonly timeToFirstTokenMs: number;
  readonly totalTurnDurationMs: number;
  readonly rawResponseHeaders?: Record<string, string>;
}

export interface GenerateOptions {
  readonly temperature: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly stopSequences?: ReadonlyArray<string>;
  readonly signal?: AbortSignal;
  readonly customHeaders?: Record<string, string>;
}

export interface LLMProviderAdapter {
  readonly providerId:
    | "anthropic"
    | "openai"
    | "google"
    | "ollama"
    | "custom"
    | string;
  readonly modelId: string;
  generateStream(
    messages: ReadonlyArray<AgentMessage>,
    tools: ReadonlyArray<ToolDefinition>,
    options: GenerateOptions
  ): AsyncIterable<CompletionChunk>;
  generateTurn(
    messages: ReadonlyArray<AgentMessage>,
    tools: ReadonlyArray<ToolDefinition>,
    options: GenerateOptions
  ): Promise<ModelTurnResponse>;
  calculateCostUSD(usage: TokenUsage): number;
}

export interface StandardTool<
  TParams = Record<string, unknown>,
  TResult = unknown,
> {
  readonly definition: ToolDefinition;
  execute(params: TParams, context: AgentToolContext): Promise<TResult>;
}

export interface AgentToolContext {
  readonly workspace?: SandboxedWorkspace;
  readonly container?: IContainerInstance;
  readonly signal?: AbortSignal;
  readonly runId: string;
  readonly scenarioId: string;
  readonly logger?: (message: string) => void;
}

export interface ToolExecutionRecord {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly output: string;
  readonly isError: boolean;
  readonly durationMs: number;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface SandboxedWorkspace {
  readonly id: string;
  readonly rootPath: string;
  readonly createdAt: number;
  initialize(): Promise<void>;
  execCommand(
    command: string,
    options?: {
      readonly timeoutMs?: number;
      readonly env?: Record<string, string>;
      readonly stdin?: string;
    }
  ): Promise<{
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
    readonly durationMs: number;
    readonly timedOut: boolean;
  }>;
  readFile(relativePath: string): Promise<string>;
  writeFile(relativePath: string, content: string): Promise<void>;
  captureGitDiff(): Promise<string>;
  listModifiedFiles(): Promise<ReadonlyArray<string>>;
  teardown(): Promise<void>;
}

export type RunTerminationReason =
  | "success"
  | "max_turns"
  | "timeout"
  | "budget_exceeded"
  | "aborted"
  | "tool_error_loop"
  | "error";

export interface ExecutionLimits {
  readonly maxTurns: number;
  readonly maxWallClockTimeMs: number;
  readonly maxCostUSD: number;
  readonly maxConsecutiveToolFailures: number;
  readonly toolTimeoutMs: number;
  readonly maxOutputSizeBytes: number;
  readonly stopOnToolFailures?: boolean;
}

export interface TurnTelemetry {
  readonly turnIndex: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly turnCostUSD: number;
  readonly timeToFirstTokenMs: number;
  readonly turnDurationMs: number;
  readonly toolExecutionDurationMs: number;
  readonly toolCallsCount: number;
  readonly toolErrorsCount: number;
  readonly finishReason: string;
}

export interface StreamCollector {
  readonly onToken?: (token: string) => void;
  readonly onToolStart?: (toolCall: ToolCallRequest) => void;
  readonly onToolEnd?: (record: ToolExecutionRecord) => void;
  readonly onTurnComplete?: (telemetry: TurnTelemetry) => void;
}

export interface ScenarioRunConfig {
  readonly runId: string;
  readonly scenarioId: string;
  readonly skillIds: ReadonlyArray<string>;
  readonly modelId: string;
  readonly provider: LLMProviderAdapter;
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly workspace?: SandboxedWorkspace;
  readonly container?: IContainerInstance;
  readonly limits: ExecutionLimits;
  readonly temperature?: number;
  readonly tags?: ReadonlyArray<string>;
  readonly metadata?: Record<string, unknown>;
}

export interface ScenarioResult {
  readonly runId: string;
  readonly scenarioId: string;
  readonly skillIds: ReadonlyArray<string>;
  readonly modelId: string;
  readonly terminationReason: RunTerminationReason;
  readonly completed: boolean;
  readonly turns: number;
  readonly turnHistory: ReadonlyArray<TurnTelemetry>;
  readonly toolHistory: ReadonlyArray<ToolExecutionRecord>;
  readonly messages: ReadonlyArray<AgentMessage>;
  readonly finalOutput: string;
  readonly totalDurationMs: number;
  readonly totalTokens: TokenUsage;
  readonly totalCostUSD: number;
  readonly consecutiveToolErrors: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly errorMessage?: string;
}

export interface MatrixExecutionConfig {
  readonly scenarioIds: ReadonlyArray<string>;
  readonly skillIds: ReadonlyArray<string>;
  readonly models: ReadonlyArray<{
    readonly modelId: string;
    readonly provider: LLMProviderAdapter;
  }>;
  readonly repetitions: number;
  readonly concurrency: number;
  readonly limits: ExecutionLimits;
  readonly temperature?: number;
  readonly workspaceRoot: string;
  readonly containerPool?: IContainerPoolManager;
}

export interface MatrixExecutionSummary {
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly totalDurationMs: number;
  readonly totalCostUSD: number;
  readonly totalTokens: TokenUsage;
  readonly results: ReadonlyArray<ScenarioResult>;
  readonly timestamp: string;
}

export interface ScenarioDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly difficulty: string;
  readonly targetSkill?: string;
  readonly baselineModel?: string;
  readonly description: string;
  readonly instructions: string;
  readonly tags?: readonly string[];
  readonly workspace?: {
    readonly fixtures?: Record<string, string>;
    readonly initialGitCommit?: string;
  };
  readonly limits?: Partial<ExecutionLimits>;
  readonly evaluation?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

export interface ScenarioCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly difficulty?: string;
  readonly targetSkill?: string;
  readonly path: string;
  readonly description: string;
}

export interface ScenarioCatalog {
  readonly version: string;
  readonly generatedAt: string;
  readonly totalScenarios: number;
  readonly categories: readonly string[];
  readonly scenarios: readonly ScenarioCatalogEntry[];
}


# 01. Architecture and Interfaces Specification

## 1. System Overview and Core Goals

The `skill-benchmarks` framework is an automated, high-fidelity benchmarking and evaluation harness designed to systematically quantify the performance, efficiency, cost, and reliability of LLM agent skills (e.g. instruction prompts, tool wrappers, context injectors, specialized workflows) against standard baseline agents.

### 1.1 Key Design Principles
1. **Isolated Hermetic Execution**: Every benchmark run executes in a disposable, sandboxed workspace to prevent disk cross-contamination and non-deterministic state leaks.
2. **Provider Agnostic**: Unified abstraction layer across major LLM providers (Anthropic Claude, OpenAI, Google Gemini, Ollama/Local OpenAI-compatible endpoints) with unified tool-calling primitives.
3. **Comprehensive Observability**: Microsecond-accurate telemetry tracking token streams, prompt cache reads/writes, tool invocation latencies, failure recovery loops, and monetary costs.
4. **Dual-Layer Evaluation**: Pairing objective deterministic validations (unit test passes, AST diff checks, lint rules) with LLM-as-a-Judge semantic grading and blind pairwise Elo rankings.
5. **Declarative Scenario Catalog**: Declarative YAML scenario definitions supporting matrix configurations (Model x Skill x Repetition x Temperature).

---

## 2. High-Level System Architecture

The following ASCII diagram illustrates the end-to-end execution pipeline of the benchmark harness:

```
+-----------------------------------------------------------------------------------+
|                              Benchmark Orchestrator                                |
|  - Scenario Discovery & Matrix Generator                                          |
|  - Concurrency Controller (Worker Pool)                                           |
|  - Lifecycle Hook Registry                                                        |
+-----------------------------------------------------------------------------------+
                                      |
          +---------------------------+---------------------------+
          |                                                       |
          v                                                       v
+-----------------------------+                         +-----------------------------+
|    Run Worker (Instance 1)  |                         |    Run Worker (Instance N)  |
|  - Scenario: bugfix-01      |                         |  - Scenario: review-04      |
|  - Skill: diagnosing-bugs   |                         |  - Skill: vanilla (control) |
+-----------------------------+                         +-----------------------------+
          |                                                       |
          +---------------------------+---------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------------+
|                             Sandboxed Workspace Manager                           |
|  - Git Worktree / RAM Disk Provisioning                                           |
|  - Fixture Hydration & Environment Variable Masking                               |
|  - Ephemeral Filesystem Isolation & Teardown Lifecycle                            |
+-----------------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------------+
|                                 Agent Loop Engine                                 |
|  +-----------------------------------------------------------------------------+  |
|  | Context Manager: Prompt Construction + Skill Injection + History Management |  |
|  +-----------------------------------------------------------------------------+  |
|                                     |                                             |
|                                     v                                             |
|  +-----------------------------------------------------------------------------+  |
|  | LLM Provider Adapter (Streaming, Token/Cache Parsing, Tool Normalization)   |  |
|  +-----------------------------------------------------------------------------+  |
|                                     |                                             |
|                                     v                                             |
|  +-----------------------------------------------------------------------------+  |
|  | Tool Dispatcher & Execution Sandbox (Bash, ReadFile, WriteFile, Edit, etc.) |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------------+
|                         Telemetry & Evaluation Pipeline                           |
|  - Stream Event Scribe (events.jsonl)                                             |
|  - Deterministic Validator (Test Runner, Git Diff Analyzer, Linter)               |
|  - LLM-as-a-Judge Evaluator & Pairwise Tournament Ranker                          |
|  - Artifact Scribe (.benchmarks/<run-id>/metrics.json)                            |
+-----------------------------------------------------------------------------------+
```

---

## 3. Runtime Environment: TypeScript & Bun

### 3.1 Runtime Choice Rationale
- **Bun Runtime**:
  - Native TypeScript execution without transpile overhead.
  - High-performance native filesystem (`Bun.file`) and subprocess APIs (`Bun.spawn`), yielding sub-millisecond process startup times for sandbox setup and tool dispatch.
  - Native SQLite driver (`bun:sqlite`) for local telemetry querying and fast state index lookups.
  - Built-in fast test runner and package manager for executing guest repo validations.
- **Strict TypeScript Typing**:
  - Zero tolerance for `any`. All boundary types (JSON bodies, provider schemas, tool payloads) are validated using strict Zod schemas and TypeScript discriminated unions.

---

## 4. Provider Adapter Interfaces

To ensure consistent agent behavior across diverse LLM backends, the harness defines a vendor-neutral provider interface.

```typescript
/**
 * Role representation across all supported LLM providers.
 */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/**
 * Universal Tool Definition Schema.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>; // JSON Schema Draft-07 representation
}

/**
 * Normalized Tool Call Request generated by the LLM.
 */
export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly rawArguments: string;
}

/**
 * Result of executing a tool call, fed back into the agent context.
 */
export interface ToolCallResult {
  readonly toolCallId: string;
  readonly output: string;
  readonly isError: boolean;
  readonly executionTimeMs: number;
}

/**
 * Token usage and cache telemetry normalized across providers.
 */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number; // e.g. Anthropic cache_creation_input_tokens
  readonly cacheReadInputTokens: number;     // e.g. Anthropic cache_read_input_tokens / OpenAI cached_tokens
  readonly totalTokens: number;
}

/**
 * Streaming completion chunk.
 */
export interface CompletionChunk {
  readonly textDelta?: string;
  readonly toolCallDeltas?: ReadonlyArray<{
    readonly index: number;
    readonly id?: string;
    readonly name?: string;
    readonly argumentsDelta?: string;
  }>;
  readonly finishReason?: "stop" | "tool_calls" | "length" | "content_filter" | "error";
  readonly usage?: TokenUsage;
}

/**
 * Complete LLM response for a single model turn.
 */
export interface ModelTurnResponse {
  readonly text: string;
  readonly toolCalls: ReadonlyArray<ToolCallRequest>;
  readonly finishReason: "stop" | "tool_calls" | "length" | "content_filter" | "error";
  readonly usage: TokenUsage;
  readonly timeToFirstTokenMs: number;
  readonly totalTurnDurationMs: number;
  readonly rawResponseHeaders: Record<string, string>;
}

/**
 * Universal LLM Provider Interface.
 */
export interface LLMProviderAdapter {
  readonly providerId: "anthropic" | "openai" | "google" | "ollama" | "custom";
  readonly modelId: string;

  /**
   * Generates a single streaming response for the given conversation history and tools.
   */
  generateStream(
    messages: ReadonlyArray<AgentMessage>,
    tools: ReadonlyArray<ToolDefinition>,
    options: GenerateOptions
  ): AsyncIterable<CompletionChunk>;

  /**
   * Generates a non-streaming turn response (or resolves the streaming accumulator).
   */
  generateTurn(
    messages: ReadonlyArray<AgentMessage>,
    tools: ReadonlyArray<ToolDefinition>,
    options: GenerateOptions
  ): Promise<ModelTurnResponse>;

  /**
   * Calculates pricing in USD based on input, output, and cache rates.
   */
  calculateCostUSD(usage: TokenUsage): number;
}

export interface GenerateOptions {
  readonly temperature: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly stopSequences?: ReadonlyArray<string>;
  readonly signal?: AbortSignal;
  readonly customHeaders?: Record<string, string>;
}
```

---

## 5. Agent Loop Engine Specification

The Agent Loop manages the cycle of context construction, model invocation, tool dispatch, and termination detection.

```
                  +--------------------------------+
                  |         Initialize Run         |
                  | - Load Prompt & System Context |
                  | - Mount Injected Skill Content |
                  +--------------------------------+
                                  |
                                  v
                +---> +-----------------------+
                |     |   Check Turn Limits   | ---> [ Exceeded Limit: Fail / Timeout ]
                |     +-----------------------+
                |                 |
                |                 v
                |     +-----------------------+
                |     | Compile Prompt & State|
                |     +-----------------------+
                |                 |
                |                 v
                |     +-----------------------+
                |     | Call LLM Provider     |
                |     | (Stream & Measure)    |
                |     +-----------------------+
                |                 |
                |                 v
                |     +-----------------------+
                |     | Has Tool Calls?       |
                |     +-----------------------+
                |            /        \
                |          Yes         No (Model Stop / Final Answer)
                |          /            \
                |         v              v
                |   +-----------+   +-----------------------+
                |   | Dispatch  |   | Capture Final Output  |
                |   | Tools in  |   +-----------------------+
                |   | Sandbox   |               |
                |   +-----------+               v
                |         |         +-----------------------+
                |         v         | Run Evaluation Engine |
                +---------+         +-----------------------+
```

### 5.1 Loop State & Transition Types

```typescript
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

export interface AgentLoopConfig {
  readonly maxTurns: number;
  readonly maxWallClockTimeMs: number;
  readonly maxConsecutiveToolFailures: number;
  readonly maxCostUSD: number;
  readonly stopOnToolFailures: boolean;
}

export interface AgentLoopState {
  readonly runId: string;
  readonly currentTurn: number;
  readonly messages: Array<AgentMessage>;
  readonly cumulativeUsage: TokenUsage;
  readonly cumulativeCostUSD: number;
  readonly consecutiveToolErrors: number;
  readonly isCompleted: boolean;
  readonly completionReason?: "success" | "max_turns" | "timeout" | "budget_exceeded" | "aborted" | "tool_error_loop";
}
```

---

## 6. Workspace Sandboxing Abstraction

To ensure reproducibility, each benchmark run must execute against a deterministic workspace. The harness uses a multi-tier sandboxing engine.

### 6.1 Sandbox Hierarchy

```
Host Operating System / Benchmark Root
  └── .benchmarks/
       └── workspaces/
            ├── <run-id-1>/ (Isolated Git Worktree or Extracted Fixture)
            │    ├── .git (detached HEAD at base commit)
            │    ├── src/
            │    ├── package.json
            │    └── tests/
            └── <run-id-2>/
```

### 6.2 Workspace Interface Definition

```typescript
export interface WorkspaceInitOptions {
  readonly scenarioId: string;
  readonly baseFixturePath: string; // Directory path or Git repo URL
  readonly targetBranchOrCommit?: string;
  readonly cleanGitState: boolean;
  readonly timeoutMs: number;
  readonly environmentOverrides?: Record<string, string>;
}

export interface ExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export interface SandboxedWorkspace {
  readonly id: string;
  readonly rootPath: string;
  readonly createdAt: number;

  /**
   * Initializes the workspace on disk (creates worktree / copies fixture).
   */
  initialize(): Promise<void>;

  /**
   * Executes a command within the sandboxed directory.
   */
  execCommand(
    command: string,
    options?: {
      readonly timeoutMs?: number;
      readonly env?: Record<string, string>;
      readonly stdin?: string;
    }
  ): Promise<ExecutionResult>;

  /**
   * Reads a file from the workspace relative path.
   */
  readFile(relativePath: string): Promise<string>;

  /**
   * Writes a file to the workspace relative path.
   */
  writeFile(relativePath: string, content: string): Promise<void>;

  /**
   * Captures the full unified git diff against the initial base commit.
   */
  captureGitDiff(): Promise<string>;

  /**
   * Inspects files changed since initialization.
   */
  listModifiedFiles(): Promise<ReadonlyArray<string>>;

  /**
   * Tears down and deletes the workspace directory.
   */
  teardown(): Promise<void>;
}
```

---

## 7. Tool Registration & Standard Suite

The harness equips running agents with a standardized toolset that mimics production agent environments.

```typescript
export interface ToolHandlerContext {
  readonly workspace: SandboxedWorkspace;
  readonly signal?: AbortSignal;
  readonly logger: (message: string) => void;
}

export interface StandardTool<TParams = Record<string, unknown>, TResult = unknown> {
  readonly definition: ToolDefinition;
  execute(params: TParams, context: ToolHandlerContext): Promise<TResult>;
}
```

### Standard Built-In Tools
1. **`run_command`**: Executes a bash command inside `workspace.rootPath` with strict execution timeouts, capturing stdout/stderr/exitCode.
2. **`read_file`**: Reads UTF-8 contents of a workspace file with line-slicing options.
3. **`write_file`**: Creates new files or completely overwrites target files.
4. **`edit_file_content`**: Performs exact string-replacement edits with line-range validation.
5. **`list_directory`**: Lists file trees with optional depth and pattern filters.
6. **`grep_search`**: High-speed ripgrep search across workspace files.
7. **`find_by_name`**: Fast file finding using glob patterns.

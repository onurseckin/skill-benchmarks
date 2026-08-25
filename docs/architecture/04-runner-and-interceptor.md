# Chapter 04: Runner Engine & Tool Execution Interceptor

[← Previous: 03. Frontier LLM Provider Adapters](03-provider-adapters.md) | [Architecture Index](README.md) | [Next: 05. Dual-Layer Evaluation →](05-dual-layer-evaluation.md)

---

## 1. Agentic Loop State Machine

The **Runner Engine** ([`src/runner/runner-engine.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/runner-engine.ts)) coordinates the multi-turn conversational loop between the Frontier LLM and the sandboxed container environment.

```
                    ┌────────────────────────────┐
                    │    1. PROMPT INJECTION     │
                    │ System Prompt + Skills +   │
                    │ Scenario Instructions      │
                    └─────────────┬──────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │    2. INFERENCE TURN       │ ◄───────────────────────────┐
                    │ Invoke Provider Adapter    │                             │
                    │ Stream Tokens & Deltas     │                             │
                    └─────────────┬──────────────┘                             │
                                  │                                            │
                                  ▼                                            │
                    ┌────────────────────────────┐                             │
                    │   3. TOOL CALL DISPATCH    │                             │
                    │ Parse & Validate Schema    │                             │
                    └─────────────┬──────────────┘                             │
                                  │                                            │
                     ┌────────────┴────────────┐                               │
                     │ Tool Call Requested?    │                               │
                     └──────┬────────────┬─────┘                               │
                        YES │            │ NO (Final Answer / Text)            │
                            ▼            ▼                                     │
           ┌────────────────────────┐   ┌────────────────────────┐             │
           │  4. TOOL INTERCEPTOR   │   │  5. TURN COMPLETION    │             │
           │ Execute inside Docker  │   │ Evaluate Artifacts     │             │
           │ Sandbox via PTY Exec   │   │ & Conclude Scenario    │             │
           └────────────┬───────────┘   └────────────────────────┘             │
                        │                                                      │
                        ▼                                                      │
           ┌────────────────────────┐                                          │
           │  6. FEEDBACK INJECTION │                                          │
           │ Format Stdout / Stderr │                                          │
           │ Append to History      │ ─────────────────────────────────────────┘
           └────────────────────────┘
```

---

## 2. Tool Execution Interception & Sandboxing

All agent tool calls are trapped and validated by the **Tool Dispatcher** ([`src/runner/tool-dispatcher.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/tool-dispatcher.ts)) and executed via [`src/runner/tool-handlers.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/tool-handlers.ts):

```
+-------------------------------------------------------------------------------+
|                       TOOL INTERCEPTION & SANDBOX MATRIX                      |
+-------------------------------------------------------------------------------+
| TOOL NAME            | TARGET DISPATCH HANDLER   | ISOLATION ENFORCEMENT      |
+----------------------+---------------------------+----------------------------+
| `execute_command`    | `handleExecuteCommand()`  | Docker container PTY exec, |
|                      |                           | timeout watchdog, cgroups  |
+----------------------+---------------------------+----------------------------+
| `read_file`          | `handleReadFile()`        | Path jail validation within|
|                      |                           | `/workspace`, byte limit   |
+----------------------+---------------------------+----------------------------+
| `write_file`         | `handleWriteFile()`       | Path jail, recursive mkdir,|
|                      |                           | atomic rewrite             |
+----------------------+---------------------------+----------------------------+
| `list_directory`     | `handleListDirectory()`   | Filtered readdir, excludes |
|                      |                           | node_modules / .git        |
+----------------------+---------------------------+----------------------------+
| `ast_inspect`        | `handleAstInspect()`      | Host TypeScript AST parser |
|                      |                           | over workspace file        |
+----------------------+---------------------------+----------------------------+
```

### 2.1 Security Invariant: Path Jailing & Escape Prevention

The tool dispatcher enforces path containment via `resolve()` and strict prefix checking:
```typescript
function assertPathWithinWorkspace(workspaceRoot: string, targetPath: string): string {
  const resolved = resolve(workspaceRoot, targetPath);
  if (!resolved.startsWith(workspaceRoot)) {
    throw new SecurityViolationError(`Access denied: path '${targetPath}' escapes workspace root.`);
  }
  return resolved;
}
```

---

## 3. Context Window Management & Compaction

Long-running agent benchmarks can exceed model context limits. The **Context Manager** ([`src/runner/context-manager.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/context-manager.ts)) implements dynamic token budgeting:

$$\text{Tokens}_{\text{total}} = \text{Tokens}_{\text{system}} + \text{Tokens}_{\text{skills}} + \sum_{k=1}^M \text{Tokens}_{\text{turn}_k}$$

```
+-------------------------------------------------------------------------------+
|                       CONTEXT COMPACTION PIPELINE                             |
|                                                                               |
|  [Active Token Count > 80% Context Window Ceiling]                            |
|                        │                                                      |
|                        ▼                                                      |
|  1. OUTPUT TRUNCATION: Truncate tool execution stdout/stderr to 200 lines    |
|                        │                                                      |
|                        ▼                                                      |
|  2. SLIDING WINDOW PRUNING: Evict intermediate tool turn cycles while         |
|     preserving initial task prompt and last 3 conversational turns.           |
|                        │                                                      |
|                        ▼                                                      |
|  3. SYNTHETIC SUMMARIZATION: Insert LLM-generated checkpoint summary turn    |
|     before continuing subsequent agent execution steps.                       |
+-------------------------------------------------------------------------------+
```

---

## 4. Real-Time Step Telemetry Streaming

Every intermediate step is serialized into a structured `StepEvent` by [`src/infrastructure/telemetry/event-scribe.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/infrastructure/telemetry/event-scribe.ts) and streamed live:

```typescript
interface StepTelemetry {
  readonly stepNumber: number;
  readonly turnType: "inference" | "tool_execution" | "compaction";
  readonly durationMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly microDollarCost: number;
  readonly toolName?: string;
  readonly exitCode?: number;
  readonly cpuTimeUsec: number;
  readonly memoryBytesPeak: number;
}
```

---

## 5. Tool Runner Module Reference

- [`src/runner/runner-engine.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/runner-engine.ts): Core multi-turn execution loop.
- [`src/runner/tool-dispatcher.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/tool-dispatcher.ts): Safe tool call routing and argument parser.
- [`src/runner/tool-handlers.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/tool-handlers.ts): Containerized shell and filesystem tool implementations.
- [`src/runner/context-manager.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/context-manager.ts): Context window compaction and token budgeting.

---

[← Previous: 03. Frontier LLM Provider Adapters](03-provider-adapters.md) | [Architecture Index](README.md) | [Next: 05. Dual-Layer Evaluation →](05-dual-layer-evaluation.md)

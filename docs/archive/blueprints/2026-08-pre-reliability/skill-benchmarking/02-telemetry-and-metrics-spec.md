# 02. Telemetry and Metrics Specification

## 1. Executive Overview

Precision measurement is the core requirement of the `skill-benchmarks` platform. Beyond simple binary pass/fail grading, the framework captures high-resolution telemetry on latency profiles, token consumption dynamics, prompt-caching efficiency, dollar expenditures, and error recovery behavior.

---

## 2. Execution Timing & Latency Metrics

All timestamps are captured as high-resolution monotonic epoch microseconds (`BigInt(performance.timeOrigin + performance.now()) * 1000n`).

### 2.1 Latency Breakdown Taxonomy

```
Total Run Wall-Clock Duration (T_total)
|-----------------------------------------------------------------------------------------|
|  Turn 1                                  |  Turn 2                                      |
|  [ LLM Inference ] [ Tool Execution ]    |  [ LLM Inference ] [ Tool Execution ]        |
|  |--TTFT--|--Gen--| |--T1--|--T2--|      |  |--TTFT--|--Gen--| |--T1--|                |
```

### 2.2 Metric Definitions

| Metric Identifier | Unit | Description |
|---|---|---|
| `wall_clock_duration_ms` | ms | Total elapsed time from agent loop start to benchmark completion. |
| `time_to_first_token_ms` (TTFT) | ms | Elapsed duration between dispatching request payload to provider API and receiving the first streaming chunk. |
| `model_generation_duration_ms` | ms | Duration spent actively streaming and decoding tokens from the LLM provider across all turns. |
| `tool_execution_duration_ms` | ms | Total cumulative duration spent executing tool handlers inside the workspace sandbox. |
| `idle_runtime_overhead_ms` | ms | Harness overhead (context serialization, JSON parsing, disk I/O, event recording): $T_{\text{overhead}} = T_{\text{total}} - (T_{\text{model}} + T_{\text{tools}})$. |

### 2.3 Statistical Distributions for Per-Tool Timings

For every tool invocation (e.g. `run_command`, `read_file`, `edit_file_content`), the harness records:
- Call count ($N$)
- Execution duration ($t_i$)
- Quantiles: $p_{50}$, $p_{90}$, $p_{95}$, $p_{99}$
- Mean ($\mu$) and Standard Deviation ($\sigma$)

---

## 3. Multi-Provider Token Tracking & Cache Telemetry

Modern frontier models leverage prompt caching (e.g. Anthropic Prompt Caching, OpenAI Prefix Caching, Google Gemini Context Caching). Telemetry must record all four token buckets per turn.

```
Total Input Tokens (T_input_total)
├── Uncached Base Input Tokens (T_uncached)
├── Cache Write / Creation Tokens (T_cache_write)
└── Cache Read / Hit Tokens (T_cache_read)

Total Output Tokens (T_output_total)
├── Standard Completion Tokens (T_completion)
└── Hidden Reasoning / Thinking Tokens (T_reasoning)
```

### 3.1 Token Consumption Data Structure

```typescript
export interface DetailedTokenTelemetry {
  // Input breakdown
  readonly uncachedInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly totalInputTokens: number;

  // Output breakdown
  readonly completionOutputTokens: number;
  readonly reasoningOutputTokens: number; // e.g. Claude 3.7 thinking, OpenAI o1/o3-mini reasoning
  readonly totalOutputTokens: number;

  // Grand total
  readonly grandTotalTokens: number;
}
```

---

## 4. Dynamic Pricing Engine & Cost Calculations

The harness maintains a centralized, versioned model pricing registry (`pricing-catalog.json`).

### 4.1 Cost Formulation

For a given run $R$ with $K$ turns:

$$\text{Cost}_{\text{total}} = \sum_{k=1}^{K} \left( C_{\text{input}}(k) + C_{\text{cache\_write}}(k) + C_{\text{cache\_read}}(k) + C_{\text{output}}(k) \right)$$

Where:
- $C_{\text{input}}(k) = \frac{T_{\text{uncached}}(k)}{10^6} \times P_{\text{uncached\_input}}$
- $C_{\text{cache\_write}}(k) = \frac{T_{\text{cache\_write}}(k)}{10^6} \times P_{\text{cache\_write}}$
- $C_{\text{cache\_read}}(k) = \frac{T_{\text{cache\_read}}(k)}{10^6} \times P_{\text{cache\_read}}$
- $C_{\text{output}}(k) = \frac{T_{\text{completion}}(k) + T_{\text{reasoning}}(k)}{10^6} \times P_{\text{output}}$

### 4.2 Standard Model Pricing Reference Matrix (USD per 1M Tokens)

```json
{
  "claude-3-7-sonnet-20250219": {
    "uncachedInputPerM": 3.00,
    "cacheWritePerM": 3.75,
    "cacheReadPerM": 0.30,
    "outputPerM": 15.00
  },
  "claude-3-5-haiku-20241022": {
    "uncachedInputPerM": 0.80,
    "cacheWritePerM": 1.00,
    "cacheReadPerM": 0.08,
    "outputPerM": 4.00
  },
  "gpt-4o": {
    "uncachedInputPerM": 2.50,
    "cacheWritePerM": 2.50,
    "cacheReadPerM": 1.25,
    "outputPerM": 10.00
  },
  "gemini-2.5-pro": {
    "uncachedInputPerM": 1.25,
    "cacheWritePerM": 1.25,
    "cacheReadPerM": 0.3125,
    "outputPerM": 5.00
  }
}
```

---

## 5. Efficiency Indices & Analytical Ratios

### 5.1 Cache-Hit Ratio (CHR)
Measures how effectively a skill maintains conversation prefix stability to exploit prompt caching:

$$\text{CHR} = \left( \frac{\sum_{k=1}^K T_{\text{cache\_read}}(k)}{\sum_{k=1}^K T_{\text{total\_input}}(k)} \right) \times 100\%$$

### 5.2 Effective Input Cost Multiplier (EICM)
Measures the cost reduction factor achieved through caching relative to baseline un-cached pricing:

$$\text{EICM} = \frac{\text{Actual Input Cost}}{\text{Nominal Uncached Input Cost}} \in (0, 1]$$

### 5.3 Token Bloat Rate (TBR)
Quantifies context expansion per turn. High TBR indicates excessive verbosity or redundant tool output polling:

$$\text{TBR} = \frac{T_{\text{input\_tokens}}(K) - T_{\text{input\_tokens}}(1)}{K - 1} \quad (\text{tokens / turn})$$

### 5.4 Information Density Index (IDI)
Measures the ratio of useful edits / diff lines produced per 1,000 output tokens generated:

$$\text{IDI} = \frac{\Delta_{\text{lines\_changed}}}{T_{\text{output\_tokens}} / 1000}$$

---

## 6. Interaction Turn & Error Recovery Dynamics

### 6.1 Interaction Dynamics
- **Total Turns ($K$)**: Number of model request/response cycles.
- **Tool Invocations per Turn**: Mean and maximum tool calls packed per turn (parallel tool calling efficiency).
- **Dead Turns**: Turns where the model neither executed a tool nor produced a final answer (e.g. blank responses, repetitive apologies).

### 6.2 Error Taxonomy

```
Agent Errors
├── Syntax / Parsing Errors
│    ├── Malformed JSON in tool call
│    └── Truncated closing delimiter
├── Schema Violations
│    ├── Unknown tool name
│    ├── Missing required parameter
│    └── Invalid parameter type
└── Execution Failures
     ├── Tool non-zero exit code (e.g. compile error, bash command failure)
     ├── File not found / permission error
     └── Subprocess timeout
```

### 6.3 Self-Correction & Recovery Efficiency Rate ($R_{\text{recovery}}$)

When an agent encounters a tool error at turn $k$, the harness tracks whether turn $k+1$ resolves the error without human intervention.

$$R_{\text{recovery}} = \frac{N_{\text{errors\_successfully\_recovered}}}{N_{\text{total\_errors\_encountered}}} \times 100\%$$

---

## 7. Telemetry Event Stream (`events.jsonl`)

Every state change, chunk, tool invocation, and metric sample emits a strongly typed event to `.benchmarks/<run-id>/events.jsonl`.

```typescript
export type TelemetryEventType =
  | "run:start"
  | "run:finish"
  | "turn:start"
  | "turn:chunk"
  | "turn:finish"
  | "tool:dispatch"
  | "tool:finish"
  | "error:encountered"
  | "error:recovered"
  | "judge:start"
  | "judge:score";

export interface BaseTelemetryEvent {
  readonly runId: string;
  readonly scenarioId: string;
  readonly skillId?: string;
  readonly modelId: string;
  readonly timestampUs: string; // BigInt serialized as string
  readonly eventType: TelemetryEventType;
}

export interface RunStartEvent extends BaseTelemetryEvent {
  readonly eventType: "run:start";
  readonly config: Record<string, unknown>;
}

export interface TurnFinishEvent extends BaseTelemetryEvent {
  readonly eventType: "turn:finish";
  readonly turnIndex: number;
  readonly usage: DetailedTokenTelemetry;
  readonly costUSD: number;
  readonly timeToFirstTokenMs: number;
  readonly durationMs: number;
  readonly toolCallsCount: number;
}

export interface ToolFinishEvent extends BaseTelemetryEvent {
  readonly eventType: "tool:finish";
  readonly turnIndex: number;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly executionTimeMs: number;
  readonly exitCode: number;
  readonly isError: boolean;
  readonly outputByteSize: number;
}

export type TelemetryEvent =
  | RunStartEvent
  | TurnFinishEvent
  | ToolFinishEvent
  | (BaseTelemetryEvent & { readonly payload: Record<string, unknown> });
```

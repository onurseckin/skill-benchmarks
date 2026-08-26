# Chapter 03: Frontier LLM Provider Adapters

[← Previous: 02. Container Sandboxing](02-container-sandbox.md) | [Architecture Index](README.md) | [Next: 04. Runner & Interceptor →](04-runner-and-interceptor.md)

---

## 1. Multi-Provider Normalization Layer

Frontier LLM providers (Anthropic, Google Gemini, OpenAI) exhibit substantial divergence in their wire protocols, message schemas, tool definitions, streaming deltas, and token telemetry accounting. **Skill-Benchmarks** encapsulates these differences through a unified provider abstraction layer governed by the Provider Factory in [`src/providers/factory.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/providers/factory.ts) and contracts in [`src/providers/types.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/providers/types.ts).

```
                      ┌─────────────────────────────────┐
                      │    CANONICAL LLM REQUEST        │
                      │    (Normalized Message History, │
                      │     Tool Schemas, Temperature)  │
                      └────────────────┬────────────────┘
                                       │
                     ┌─────────────────┼─────────────────┐
                     ▼                 ▼                 ▼
          ┌────────────────────┐ ┌───────────────┐ ┌───────────────┐
          │ Anthropic Claude   │ │ Google Gemini │ │ OpenAI GPT-4o │
          │ Messages API       │ │ GenerateContent││ Chat/Responses│
          │ Adapter            │ │ Adapter       │ │ Adapter       │
          │(src/providers/     │ │(src/providers/│ │(src/providers/│
          │ anthropic.ts)      │ │ gemini.ts)    │ │ openai.ts)    │
          └──────────┬─────────┘ └───────┬───────┘ └───────┬───────┘
                     │                   │                 │
                     └─────────────────┬─┴─────────────────┘
                                       ▼
                      ┌─────────────────────────────────┐
                      │    CANONICAL LLM RESPONSE       │
                      │    • Content String / Delta     │
                      │    • Tool Call Requests         │
                      │    • Input/Output/Cache Tokens  │
                      │    • Latency & Real-Time Cost   │
                      └─────────────────────────────────┘
```

---

## 2. Wire Protocol Mapping & Invariant Conversion

### 2.1 Message Roles & Format Normalization

| Canonical Model | Anthropic (`/v1/messages`)                                                   | Google Gemini (`:generateContent`)                                    | OpenAI (`/v1/chat/completions`)           |
| :-------------- | :--------------------------------------------------------------------------- | :-------------------------------------------------------------------- | :---------------------------------------- |
| `system`        | Top-level `system` prompt parameter                                          | Top-level `systemInstruction.parts`                                   | Message with `role: "system"`             |
| `user`          | `{ role: "user", content: [...] }`                                           | `{ role: "user", parts: [...] }`                                      | `{ role: "user", content: [...] }`        |
| `assistant`     | `{ role: "assistant", content: [...] }`                                      | `{ role: "model", parts: [...] }`                                     | `{ role: "assistant", content: [...] }`   |
| `tool_call`     | `type: "tool_use"` block in content                                          | `functionCall: { name, args }` part                                   | `tool_calls: [{ id, function }]`          |
| `tool_result`   | `{ role: "user", content: [{ type: "tool_result", tool_use_id, content }] }` | `{ role: "user", parts: [{ functionResponse: { name, response } }] }` | `{ role: "tool", tool_call_id, content }` |

### 2.2 Streaming Delta Handling

Adapters normalize incoming server-sent events (SSE) into a standardized `AsyncIterable<ProviderChunk>`:

- **Anthropic**: Listens for `content_block_start`, `content_block_delta` (`text_delta`, `input_json_delta`), and `message_delta` (usage stats).
- **Gemini**: Consumes chunked `GenerateContentResponse` candidate parts, extracting text and accumulating partial function call arguments.
- **OpenAI**: Processes `choices[0].delta` containing `content` and indexed `tool_calls` argument fragments.

---

## 3. Dynamic Pricing Engine & Cost Calculation

To evaluate model economic efficiency, [`src/providers/pricing.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/providers/pricing.ts) evaluates exact micro-dollar costs per inference turn:

$$\text{Cost}_{\text{turn}} = (N_{\text{input}} \times R_{\text{input}}) + (N_{\text{cached}} \times R_{\text{cached}}) + (N_{\text{output}} \times R_{\text{output}})$$

```
+-------------------------------------------------------------------------------+
| MODEL PRICING MATRIX (USD per 1,000,000 Tokens)                               |
+-------------------------------------------------------------------------------+
| MODEL                      | PROMPT / INPUT  | CACHED PROMPT  | COMPLETION    |
+----------------------------+-----------------+----------------+---------------+
| Claude 3.5 Sonnet          | $3.00           | $0.30          | $15.00        |
| Claude 3.5 Haiku           | $0.80           | $0.08          | $4.00         |
| Claude 3 Opus              | $15.00          | $1.50          | $75.00        |
| Gemini 1.5 Pro             | $3.50           | $0.875         | $10.50        |
| Gemini 1.5 Flash           | $0.075          | $0.01875       | $0.30         |
| GPT-4o                     | $2.50           | $1.25          | $10.00        |
| GPT-4o-mini                | $0.15           | $0.075         | $0.60         |
| o1 / o1-preview            | $15.00          | $7.50          | $60.00        |
+-------------------------------------------------------------------------------+
```

---

## 4. Resilience, Exponential Backoff & Jitter

Network transients and rate limits (HTTP 429 / 503) are mitigated via randomized exponential backoff with full jitter:

$$t_{\text{sleep}} = \min\left(t_{\max},\; t_{\text{base}} \times 2^{\text{attempt}}\right) \times \text{Uniform}(0.5, 1.5)$$

```
     RETRY STATE MACHINE (src/providers/anthropic.ts, gemini.ts, openai.ts)

        [Dispatch Request]
                │
                ├───► HTTP 200 OK ───────────► [Return Normalized Response]
                │
                ├───► HTTP 429 / 503 / Timeout
                │            │
                │            ▼
                │     [Attempt < Max Retries (5)?]
                │            ├───► YES ──► [Compute Jitter Delay] ──► [Sleep] ──┐
                │            │                                                  │
                │            └───► NO ───► [Throw RateLimitExceeded / Timeout]  │
                └───────────────────────────────────────────────────────────────┘
```

---

## 5. Frontier Adapter Module Reference

- [`src/providers/anthropic.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/providers/anthropic.ts): Anthropic Messages API client, tool definition generator, content block parser.
- [`src/providers/gemini.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/providers/gemini.ts): Gemini GenerateContent client, function declaration serializer, part stream accumulator.
- [`src/providers/openai.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/providers/openai.ts): OpenAI Chat Completions client, structured schema validation, streaming delta processor.
- [`src/providers/pricing.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/providers/pricing.ts): Model cost rate cards and micro-dollar accounting math.

---

[← Previous: 02. Container Sandboxing](02-container-sandbox.md) | [Architecture Index](README.md) | [Next: 04. Runner & Interceptor →](04-runner-and-interceptor.md)

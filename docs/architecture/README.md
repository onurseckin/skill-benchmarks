# Skill-Benchmarks Architectural Specification & Deep-Dive Manual

Welcome to the comprehensive architectural documentation for the **Skill-Benchmarks** evaluation engine. This manual details the internal engineering, mathematical formalisms, concurrency models, sandboxing invariants, evaluation pipelines, and streaming protocols underpinning the benchmarking platform.

---

## 🗺️ Architectural Table of Contents

The documentation is organized into eight sequential, in-depth architectural chapters:

| Chapter | Title                                                                      | Primary Focus & Subsystems Covered                                                                                                             | Source Anchors                                                                                                                                                                                                                                                                                                                                                              |
| :------ | :------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **01**  | [System Overview & Concurrency Model](01-system-overview.md)               | High-level blueprint, Work/Span $P = W/S$ concurrency theory, Amdahl's Law, Brent's Theorem, execution lifecycle.                              | [`src/runner/index.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/index.ts), [`src/runner/runner-engine.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/runner-engine.ts)                                                                                                                                                    |
| **02**  | [Container Sandboxing & Resource Isolation](02-container-sandbox.md)       | Docker pre-warmed container pools, state machine transitions, copy-on-write workspace hydration, cgroups v2 telemetry, GC reaper.              | [`src/infrastructure/container/pool.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/infrastructure/container/pool.ts), [`src/infrastructure/workspace/hydration.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/infrastructure/workspace/hydration.ts)                                                                                      |
| **03**  | [Frontier LLM Provider Adapters](03-provider-adapters.md)                  | Normalization of Anthropic, Gemini, OpenAI APIs, schema translation, token accounting, dynamic pricing, exponential jitter backoff.            | [`src/providers/anthropic.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/providers/anthropic.ts), [`src/providers/gemini.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/providers/gemini.ts), [`src/providers/openai.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/providers/openai.ts)                                 |
| **04**  | [Runner Engine & Tool Execution Interceptor](04-runner-and-interceptor.md) | Multi-turn agentic execution loop, tool dispatch & interception, step telemetry streaming, context window compaction algorithms.               | [`src/runner/runner-engine.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/runner-engine.ts), [`src/runner/tool-dispatcher.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/tool-dispatcher.ts)                                                                                                                                |
| **05**  | [Evidence Eligibility & Evaluation](05-dual-layer-evaluation.md)           | Deterministic evidence validation, optional judge evidence, composite evaluation, and fail-closed benchmark authority.                         | [`src/eval/deterministic.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/eval/deterministic.ts), [`src/eval/evidence-adapter.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/eval/evidence-adapter.ts), [`src/shared/benchmark-authority.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/shared/benchmark-authority.ts)     |
| **06**  | [Telemetry Storage & Reporting Pipeline](06-telemetry-and-reporting.md)    | SQLite schema (WAL mode), metrics aggregation, multi-objective Pareto efficiency frontiers (Cost vs. Accuracy vs. Latency), report generators. | [`src/reporting/db.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/db.ts), [`src/reporting/aggregator.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/aggregator.ts), [`src/reporting/html-dashboard.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/html-dashboard.ts)                       |
| **07**  | [Chaos Fault Injection](07-fuzzing-and-chaos.md)                           | Explicit container fault schedules and diagnostic recovery observations without benchmark resilience claims.                                   | [`src/chaos/chaos-engine.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/chaos/chaos-engine.ts), [`src/chaos/fault-injector.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/chaos/fault-injector.ts)                                                                                                                                        |
| **08**  | [Binary Terminal Streaming Protocol](08-binary-terminal-streaming.md)      | 16-byte fixed-header binary WebSocket protocol, PTY multiplexing, ANSI/UTF-8 double-buffered canvas screen rendering.                          | [`src/streaming/canvas-streamer.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/streaming/canvas-streamer.ts), [`src/tunnel/stream-tunnel.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/tunnel/stream-tunnel.ts), [`src/tunnel/pty-multiplexer.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/tunnel/pty-multiplexer.ts) |

---

## 🏛️ System Philosophy & Core Design Principles

Skill-Benchmarks is built upon five non-negotiable architectural tenets:

```
+-------------------------------------------------------------------------------+
|                           CORE DESIGN PRINCIPLES                              |
+-------------------------------------------------------------------------------+
| 1. ZERO-TRUST ISOLATION                                                       |
|    Every benchmark run executes in an ephemeral, cgroup-constrained Docker    |
|    container with read-only rootfs overlays and strict process quotas.       |
+-------------------------------------------------------------------------------+
| 2. EVIDENCE-GATED EVALUATION                                                  |
|    Score and pass claims exist only after nonempty deterministic evidence,    |
|    any required judge evidence, and cross-artifact identity all validate.     |
+-------------------------------------------------------------------------------+
| 3. WORK/SPAN CONCURRENCY SCALING                                              |
|    Workloads are partitioned along independent Directed Acyclic Graphs (DAG),|
|    maximizing parallelism P = W / S without cross-container lock contention.  |
+-------------------------------------------------------------------------------+
| 4. SUB-MILLISECOND OBSERVABILITY                                              |
|    Every tool execution, model token delta, and kernel resource pressure      |
|    is captured into high-speed ring buffers and written to WAL-mode SQLite.   |
+-------------------------------------------------------------------------------+
| 5. PROTOCOL-LEVEL STREAMING FIDELITY                                          |
|    Real-time interactive terminal outputs and telemetry are multiplexed over  |
|    a compact 16-byte binary framing protocol directly to remote consumers.    |
+-------------------------------------------------------------------------------+
```

---

## 🧭 Navigation Quick Links

- **Next Chapter**: [01. System Overview & Concurrency Model](01-system-overview.md)
- **Container Sandbox**: [02. Container Sandboxing & Resource Isolation](02-container-sandbox.md)
- **Providers & Runner**: [03. Frontier LLM Provider Adapters](03-provider-adapters.md) | [04. Runner & Interceptor](04-runner-and-interceptor.md)
- **Eval & Analytics**: [05. Dual-Layer Evaluation](05-dual-layer-evaluation.md) | [06. Telemetry & Reporting](06-telemetry-and-reporting.md)
- **Fault Injection & Live Stream**: [07. Chaos Fault Injection](07-fuzzing-and-chaos.md) | [08. Binary Streaming](08-binary-terminal-streaming.md)

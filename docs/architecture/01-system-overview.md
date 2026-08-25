# Chapter 01: System Overview & Concurrency Model

[← Back to Architecture Index](README.md) | [Next: 02. Container Sandboxing & Resource Isolation →](02-container-sandbox.md)

---

## 1. High-Level Architectural Blueprint

The **Skill-Benchmarks** framework is an enterprise-grade, deterministic benchmarking harness engineered to measure, evaluate, and rank frontier LLM agents across diverse software engineering capabilities. The architecture enforces strict containerized sandbox isolation, dual-layer evaluation (deterministic AST grading + calibrated LLM-as-a-Judge consensus), continuous kernel telemetry, and real-time binary streaming.

```
+---------------------------------------------------------------------------------------------------+
|                                     CLI & CONTROL PLANE                                           |
|   bin/skill-benchmarks  ───►  src/cli/parser.ts  ───►  src/runner/matrix-runner.ts                |
+---------------------------------------------------------------------------------------------------+
                                            │
                                            ▼
+---------------------------------------------------------------------------------------------------+
|                                  CONCURRENCY & DISPATCH PIPELINE                                  |
|   Work/Span Concurrency Controller  (Parallel Lanes P = W / S, Semaphore Task Pool)              |
+---------------------------------------------------------------------------------------------------+
           │                                 │                                 │
           ▼                                 ▼                                 ▼
+──────────────────────+          +──────────────────────+          +──────────────────────+
|   LANE 1 (Task A)    |          |   LANE 2 (Task B)    |          |   LANE N (Task K)    |
|                      |          |                      |          |                      |
|  Provider Adapter    |          |  Provider Adapter    |          |  Provider Adapter    |
|  (Anthropic/OpenAI)  |          |  (Gemini 1.5 Pro)    |          |  (Claude 3.5 Sonnet) |
|          │           |          |          │           |          |          │           |
|          ▼           |          |          ▼           |          |          ▼           |
|  Runner Engine       |          |  Runner Engine       |          |  Runner Engine       |
|  (Agentic Loop)      |          |  (Agentic Loop)      |          |  (Agentic Loop)      |
|          │           |          |          │           |          |          │           |
|          ▼           |          |          ▼           |          |          ▼           |
|  Tool Interceptor    |          |  Tool Interceptor    |          |  Tool Interceptor    |
|  (Exec / FS / AST)   |          |  (Exec / FS / AST)   |          |  (Exec / FS / AST)   |
|          │           |          |          │           |          |          │           |
|          ▼           |          |          ▼           |          |          ▼           |
|  Container Sandbox   |          |  Container Sandbox   |          |  Container Sandbox   |
|  (cgroups v2 / PTY)  |          |  (cgroups v2 / PTY)  |          |  (cgroups v2 / PTY)  |
+──────────────────────+          +──────────────────────+          +──────────────────────+
           │                                 │                                 │
           └─────────────────────────────────┼─────────────────────────────────┘
                                             ▼
+---------------------------------------------------------------------------------------------------+
|                                    DUAL-LAYER EVALUATION                                          |
|   1. Deterministic Layer: AST Parsing, Structural Invariants, Exit Codes (src/eval/deterministic)  |
|   2. Semantic Layer: Multi-Judge Consensus Scoring & Elo Solver (src/eval/llm-judge, pairwise-elo)|
+---------------------------------------------------------------------------------------------------+
                                             │
                                             ▼
+---------------------------------------------------------------------------------------------------+
|                                 TELEMETRY & STREAMING INGESTION                                   |
|   SQLite DB (WAL Mode)  ◄───  Event Scribe  ───►  Binary WebSocket Multiplexer (Port 4001)       |
|   (src/reporting/db.ts)       (src/telemetry)     (src/tunnel/stream-tunnel.ts)                   |
+---------------------------------------------------------------------------------------------------+
                                             │
                                             ▼
+---------------------------------------------------------------------------------------------------+
|                                     REPORTING & VISUALIZATION                                     |
|   Leaderboard Generator (data/leaderboard.md)  │  Interactive Dashboard (data/dashboard.html)     |
|   Pareto Frontier Engine (Cost vs. Elo vs. Latency)                                               |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Theoretical Foundations: Work/Span Concurrency Model

Skill-Benchmarks models benchmark matrix execution as a Directed Acyclic Graph (DAG) of computational jobs. We formalize scheduling efficiency using the **Work-Span (Cilk) Model**.

### 2.1 Formal Mathematical Definitions

1. **Work ($W$ or $T_1$)**:
   The total time required to execute all benchmark tasks sequentially on a single worker thread:
   $$W = \sum_{i=1}^{N} t_i$$
   where $t_i$ represents the end-to-end wall-clock latency of task $i$ (including LLM generation, tool execution, container bootstrapping, and evaluation).

2. **Span ($S$ or $T_\infty$)**:
   The execution time along the critical path (the longest directed sequence of dependent tasks):
   $$S = \max_{p \in \text{Paths}(G)} \sum_{j \in p} t_j$$
   In Skill-Benchmarks, since independent benchmark scenarios have zero cross-dependencies, the intra-batch dependency graph consists of disjoint task nodes. Thus, the theoretical span is bounded by the longest individual scenario execution:
   $$S = \max_{1 \le i \le N} (t_i)$$

3. **Theoretical Parallelism ($P$)**:
   The maximum speedup achievable with unlimited processing capacity:
   $$P = \frac{W}{S} = \frac{\sum_{i=1}^N t_i}{\max_{i} t_i}$$

4. **Brent's Theorem (Scheduling Bound)**:
   For any greedy scheduler with $p$ physical worker threads/containers, the total parallel execution time $T_p$ is bounded by:
   $$T_p \le \frac{W - S}{p} + S$$
   This guarantees that as $p \to \infty$, $T_p \to S$, ensuring optimal horizontal scaling up to the container host's hardware capacity.

5. **Amdahl's Law Compliance**:
   Let $\sigma = \frac{S_{\text{overhead}}}{W}$ denote the strictly serial fraction (pool initialization, SQLite schema migration, final Elo matrix compilation). The speedup $S_p$ with $p$ workers is:
   $$S_p = \frac{1}{\sigma + \frac{1 - \sigma}{p}}$$
   Skill-Benchmarks minimizes $\sigma < 0.005$ via pre-warmed container pools and concurrent WAL writes.

```
          TASK DEPENDENCY & WORK-SPAN DECOMPOSITION GRAPH
          
          [Init Warm Pool] (Serial Overhead S_0)
                 │
        ┌────────┼────────┬────────────────┐
        ▼        ▼        ▼                ▼
     [Task 1] [Task 2] [Task 3]  ...   [Task N]  (Parallel Work W_par)
      (t_1)    (t_2)    (t_3)            (t_N)
        │        │        │                │
        └────────┼────────┴────────────────┘
                 ▼
        [Elo Matrix Solver & Report Gen] (Serial Span S_end)
        
        Total Work W = S_0 + \sum(t_i) + S_end
        Total Span S = S_0 + max(t_i) + S_end
        Parallelism  P = W / S
```

---

## 3. End-to-End Execution Lifecycle

The execution of a benchmark run progresses through eight discrete phases:

```
+---------------+      +---------------+      +---------------+      +---------------+
| 1. INGESTION  | ───► | 2. HYDRATION  | ───► | 3. DISPATCH   | ───► | 4. INFERENCE  |
| Scenario &    |      | Ephemeral CoW |      | Warm Pool     |      | Frontier LLM  |
| Skill Specs   |      | Overlay Mount |      | Lease Acquire |      | Normalized API|
+---------------+      +---------------+      +---------------+      +---------------+
                                                                             │
                                                                             ▼
+---------------+      +---------------+      +---------------+      +---------------+
| 8. REPORTING  | ◄─── | 7. TELEMETRY  | ◄─── | 6. DUAL-EVAL  | ◄─── | 5. INTERCEPT  |
| Leaderboard & |      | SQLite WAL &  |      | AST Parser +  |      | Tool Sandbox  |
| Pareto Front  |      | Binary Stream |      | LLM Judge Elo |      | Exec & PTY    |
+---------------+      +---------------+      +---------------+      +---------------+
```

1. **Ingestion**: The CLI parses target models, scenario filters, iteration counts, and timeout budgets via [`src/cli/parser.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/cli/parser.ts) and [`src/runner/scenario-loader.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/scenario-loader.ts).
2. **Hydration**: The workspace engine extracts base testbed tarballs into isolated directories and records a baseline SHA-256 state fingerprint via [`src/infrastructure/workspace/hydration.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/infrastructure/workspace/hydration.ts).
3. **Dispatch**: The container pool assigns an idle, pre-warmed Docker container instance to the task via [`src/infrastructure/container/pool.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/infrastructure/container/pool.ts).
4. **Inference**: The provider adapter translates prompt messages and active skill manifests into provider-specific payloads (Anthropic/Gemini/OpenAI) with streaming enabled via [`src/providers/factory.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/providers/factory.ts).
5. **Interception**: When the LLM issues tool invocations (e.g., `execute_command`, `read_file`, `write_file`), the runner engine traps the call, validates arguments, executes within the container sandbox, and streams terminal stdout/stderr via [`src/runner/tool-dispatcher.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/tool-dispatcher.ts).
6. **Dual-Layer Evaluation**: Upon task completion or timeout, Layer 1 executes deterministic AST checks and automated unit test grading ([`src/eval/deterministic.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/eval/deterministic.ts)). Layer 2 invokes multi-judge blind LLM evaluations and solves pairwise Bradley-Terry Elo ratings ([`src/eval/pairwise-elo.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/eval/pairwise-elo.ts)).
7. **Telemetry Persistence**: Step-level durations, token counts, dollar costs, cgroups resource metrics (CPU/RAM/IO), and event transcripts are saved into SQLite ([`src/reporting/db.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/db.ts)) and broadcasted over WebSockets ([`src/tunnel/stream-tunnel.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/tunnel/stream-tunnel.ts)).
8. **Reporting & Analysis**: Markdown leaderboards, standalone HTML dashboards, and multi-objective Pareto frontiers (Cost vs. Accuracy vs. Latency) are rendered to disk ([`src/reporting/aggregator.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/aggregator.ts)).

---

## 4. Key Subsystem Source Code References

| Subsystem Component | Primary Implementation | Architectural Contract |
| :--- | :--- | :--- |
| **Matrix Orchestration** | [`src/runner/matrix-runner.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/matrix-runner.ts) | Manages concurrent task matrix dispatch and worker allocation. |
| **Agentic Runner Engine** | [`src/runner/runner-engine.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/runner-engine.ts) | Implements multi-turn prompt-response-tool cycles. |
| **Container Sandbox Pool** | [`src/infrastructure/container/pool.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/infrastructure/container/pool.ts) | Controls Docker container lifecycle, warm pooling, and cgroup metrics. |
| **Workspace Hydration** | [`src/infrastructure/workspace/hydration.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/infrastructure/workspace/hydration.ts) | Manages copy-on-write workspace directories and SHA-256 diffing. |
| **Frontier Provider Adapters** | [`src/providers/factory.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/providers/factory.ts) | Factory layer normalizing Anthropic, Gemini, and OpenAI APIs. |
| **Deterministic AST Evaluator**| [`src/eval/deterministic.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/eval/deterministic.ts) | Performs static AST inspection and test suite execution. |
| **Pairwise Elo Solver** | [`src/eval/pairwise-elo.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/eval/pairwise-elo.ts) | Implements iterative Bradley-Terry Maximum Likelihood Estimation. |
| **Telemetry Database Engine** | [`src/reporting/db.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/db.ts) | SQLite database layer running in Write-Ahead-Logging (WAL) mode. |
| **Binary Stream Multiplexer** | [`src/tunnel/stream-tunnel.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/tunnel/stream-tunnel.ts) | Multiplexes 16-byte framed binary PTY streams over WebSockets. |

---

[← Back to Architecture Index](README.md) | [Next: 02. Container Sandboxing & Resource Isolation →](02-container-sandbox.md)

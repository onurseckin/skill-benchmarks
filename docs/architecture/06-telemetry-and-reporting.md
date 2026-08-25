# Chapter 06: Telemetry Storage & Reporting Pipeline

[← Previous: 05. Dual-Layer Evaluation](05-dual-layer-evaluation.md) | [Architecture Index](README.md) | [Next: 07. Scenario Fuzzing & Chaos →](07-fuzzing-and-chaos.md)

---

## 1. SQLite Telemetry Storage Engine

All benchmark execution runs, scenario steps, kernel telemetry metrics, judge outcomes, and Elo ratings are persisted into a high-performance SQLite database ([`src/reporting/db.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/db.ts)) configured in **Write-Ahead Logging (WAL)** mode.

### 1.1 Relational Entity-Relationship Diagram

```
+─────────────────────────+            +─────────────────────────+
|     benchmark_runs      | 1        * |       benchmarks        |
|─────────────────────────|───────────►|─────────────────────────|
| id (TEXT PRIMARY KEY)   |            | id (TEXT PRIMARY KEY)   |
| run_timestamp (INTEGER) |            | run_id (TEXT FK)        |
| total_scenarios (INT)   |            | scenario_id (TEXT)      |
| total_cost (REAL)       |            | model (TEXT)            |
| overall_pass_rate (REAL)|            | status (TEXT)           |
+─────────────────────────+            | pass (INTEGER)          |
                                       | duration_ms (INTEGER)   |
                                       | cost (REAL)             |
                                       +───────────┬─────────────+
                                                   │ 1
                                                   │
                                                   │ *
                                       +───────────▼─────────────+
                                       |     benchmark_steps     |
                                       |─────────────────────────|
                                       | id (TEXT PRIMARY KEY)   |
                                       | benchmark_id (TEXT FK)  |
                                       | step_number (INTEGER)   |
                                       | turn_type (TEXT)        |
                                       | tool_name (TEXT)        |
                                       | prompt_tokens (INT)     |
                                       | completion_tokens (INT) |
                                       | step_cost (REAL)        |
                                       | duration_ms (INTEGER)   |
                                       | cpu_usec (INTEGER)      |
                                       | memory_bytes (INTEGER)  |
                                       +─────────────────────────+
```

### 1.2 Performance & Concurrency Invariants

- **`PRAGMA journal_mode = WAL;`**: Allows concurrent readers while asynchronous telemetry transactions commit.
- **`PRAGMA synchronous = NORMAL;`**: Balances durability with sub-millisecond step append latency.
- **`PRAGMA foreign_keys = ON;`**: Enforces strict cascading deletions and relational integrity.
- **Index Optimization**: B-Tree indices on `(run_id, model)`, `(scenario_id)`, and `(benchmark_id, step_number)`.

---

## 2. Multi-Objective Pareto Efficiency Frontiers

Evaluating LLM models requires balancing competing objectives: **Accuracy (Elo Rating)** vs. **Inference Cost ($/task)** vs. **Latency (ms/task)**. The Aggregator engine ([`src/reporting/aggregator.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/aggregator.ts)) computes the **Pareto Optimal Frontier**.

### 2.1 Pareto Dominance Formalism

A model vector $\mathbf{u} = (\text{Elo}_u, \text{Cost}_u, \text{Latency}_u)$ **dominates** another model vector $\mathbf{v}$ (denoted $\mathbf{u} \succ \mathbf{v}$) if and only if:

$$\forall k \in \{\text{Elo}, \text{Cost}, \text{Latency}\},\; u_k \text{ is at least as good as } v_k \quad \land \quad \exists k \text{ s.t. } u_k \text{ is strictly better than } v_k$$

The **Pareto Frontier** $\mathcal{P}$ is the set of all non-dominated models:
$$\mathcal{P} = \{ \mathbf{u} \in \mathcal{M} \mid \nexists \mathbf{v} \in \mathcal{M} \text{ such that } \mathbf{v} \succ \mathbf{u} \}$$

### 2.2 Pareto Efficiency Trade-Off Visualization

```
   ELO RATING (Higher is Better)
     ▲
1400 ┼                                   [Claude 3.5 Sonnet] ★ Pareto Front
     │                                     (High Elo, Moderate Cost)
1350 ┼                      [GPT-4o] ★
     │
1300 ┼
     │
1250 ┼                                             [Claude 3 Opus] (Dominated)
     │
1200 ┼           [Gemini 1.5 Flash] ★
     │            (Ultra Low Cost, Moderate Elo)
1150 ┼─────────────────────────────────────────────────────────────►
     0.00        0.05        0.10        0.15        0.20        0.25
                         INFERENCE COST ($ / Scenario)
```

---

## 3. Reporting Deliverables, Standalone Badges & TUI Canvas

The telemetry pipeline renders rich static, interactive, and terminal-native deliverables:

1. **Relational Database (`<output-root>/db/benchmarks.sqlite`)**: Direct SQL query access to operational records and eligible benchmark cohorts.
2. **Markdown Leaderboard Export**: Operator-requested markdown tables generated from eligible evidence by [`src/reporting/markdown-leaderboard.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/markdown-leaderboard.ts).
3. **Interactive Dashboard Export**: Operator-requested self-contained HTML generated from eligible evidence by [`src/reporting/html-dashboard.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/html-dashboard.ts).
4. **Standalone Report Cards & Badges** ([`src/reporting/report-card.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/report-card.ts)): Self-contained `.svg` badges and `.html` report cards generated via `--export-card <svg|html>`.
5. **Interactive REPL HUD & ANSI Canvas** ([`src/tui/`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/tui/index.ts)): Terminal box-drawing canvas, real-time trial throughput HUD, ASCII Pareto trade-off charts, and latency percentile bars.

```
+───────────────────────────────────────────────────────────────────────────────+
|                      STANDALONE REPORT CARD PIPELINE                          |
+───────────────────────────────────────────────────────────────────────────────+
|                                                                               |
|   Benchmark Trial / Summary Data (Score, Duration, Verification Checks)       |
|                                     │                                         |
|                 ┌───────────────────┴───────────────────┐                     |
|                 ▼                                       ▼                     |
|   ┌───────────────────────────┐           ┌───────────────────────────┐       |
|   │ SVG Shield Badge Exporter │           │ Standalone HTML Exporter  │       |
|   │ (generateBenchmarkBadgeSvg)│          │ (generateReportCardHtml)  │       |
|   └─────────────┬─────────────┘           └─────────────┬─────────────┘       |
|                 │                                       │                     |
|                 ▼                                       ▼                     |
|   Embeddable SVG Badge for READMEs         Self-Contained Report Card for PRs |
+───────────────────────────────────────────────────────────────────────────────+
```

---

## 4. Telemetry Module Reference

- [`src/reporting/db.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/db.ts): SQLite database connection manager and schema DDL.
- [`src/reporting/aggregator.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/aggregator.ts): Statistical aggregation and Pareto front algorithms.
- [`src/reporting/report-card.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/report-card.ts): Standalone SVG badge and HTML report card generator.
- [`src/reporting/markdown-leaderboard.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/markdown-leaderboard.ts): Markdown leaderboard generator.
- [`src/reporting/html-dashboard.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/reporting/html-dashboard.ts): Interactive Neo-Brutalist dashboard generator.
- [`src/tui/canvas.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/tui/canvas.ts): ANSI double-buffered box-drawing canvas.
- [`src/tui/hud.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/tui/hud.ts): Real-time REPL execution HUD.
- [`src/tui/ascii-charts.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/tui/ascii-charts.ts): Terminal ASCII Pareto and sparkline visualizers.

---

[← Previous: 05. Dual-Layer Evaluation](05-dual-layer-evaluation.md) | [Architecture Index](README.md) | [Next: 07. Scenario Fuzzing & Chaos →](07-fuzzing-and-chaos.md)

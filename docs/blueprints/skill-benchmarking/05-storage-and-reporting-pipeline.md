# 05. Storage and Reporting Pipeline Specification

## 1. Storage Layout and Artifact Hierarchy

All benchmark artifacts, raw telemetry streams, transcripts, diffs, and evaluation scores are persisted on disk under the `.benchmarks/` root directory.

```
.benchmarks/
├── benchmarks.sqlite                  # SQLite query index for fast aggregation
├── manifests/                         # Run manifest index
│    └── <run-id>.json
├── runs/
│    └── <run-id>/
│         ├── manifest.json            # Run metadata, git commit, model config
│         ├── events.jsonl             # High-resolution monotonic event stream
│         ├── transcript.jsonl         # Full agent conversation transcript
│         ├── git.diff                 # Unified git diff generated in sandbox
│         ├── metrics.json             # Aggregated telemetry and performance metrics
│         └── evaluation.json          # Deterministic check results & judge rubrics
└── reports/
     ├── leaderboard.md                # Generated markdown leaderboard
     ├── leaderboard.json              # Machine-readable summary matrix
     └── index.html                    # Standalone interactive dashboard
```

---

## 2. File Schemas and Data Formats

### 2.1 `manifest.json` Schema

```typescript
export interface RunManifest {
  readonly runId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly category: string;
  readonly skillId: string; // e.g. "diagnosing-bugs", "vanilla-control"
  readonly skillVersion?: string;
  readonly modelId: string; // e.g. "claude-3-7-sonnet-20250219"
  readonly providerId: string;
  readonly modelParameters: {
    readonly temperature: number;
    readonly maxTokens?: number;
    readonly topP?: number;
  };
  readonly environment: {
    readonly os: string;
    readonly arch: string;
    readonly bunVersion: string;
    readonly hostCommitSha: string;
  };
  readonly startedAt: string; // ISO 8601
  readonly completedAt: string; // ISO 8601
  readonly status: "completed" | "failed" | "timed_out" | "aborted";
}
```

### 2.2 `metrics.json` Schema

```typescript
export interface RunMetricsSummary {
  readonly runId: string;
  readonly timing: {
    readonly wallClockDurationMs: number;
    readonly timeToFirstTokenMs: number;
    readonly modelGenerationDurationMs: number;
    readonly toolExecutionDurationMs: number;
    readonly harnessOverheadMs: number;
  };
  readonly tokens: {
    readonly uncachedInputTokens: number;
    readonly cacheCreationInputTokens: number;
    readonly cacheReadInputTokens: number;
    readonly completionOutputTokens: number;
    readonly reasoningOutputTokens: number;
    readonly totalTokens: number;
    readonly cacheHitRatio: number; // Percentage (0-100)
    readonly tokenBloatRate: number; // Tokens / turn
  };
  readonly cost: {
    readonly totalCostUSD: number;
    readonly inputCostUSD: number;
    readonly outputCostUSD: number;
    readonly effectiveCostMultiplier: number;
  };
  readonly interaction: {
    readonly totalTurns: number;
    readonly totalToolCalls: number;
    readonly toolCallsPerTurnMean: number;
    readonly errorCount: number;
    readonly errorRecoveryRate: number;
  };
  readonly toolBreakdowns: Record<
    string,
    {
      readonly callCount: number;
      readonly totalDurationMs: number;
      readonly meanDurationMs: number;
      readonly p95DurationMs: number;
      readonly errorCount: number;
    }
  >;
}
```

### 2.3 `evaluation.json` Schema

```typescript
export interface RunEvaluationSummary {
  readonly runId: string;
  readonly scenarioId: string;
  readonly deterministic: {
    readonly passed: boolean;
    readonly score: number; // 0 - 100
    readonly checks: ReadonlyArray<{
      readonly description: string;
      readonly passed: boolean;
      readonly exitCode?: number;
      readonly durationMs: number;
    }>;
  };
  readonly judge?: {
    readonly judgeModelId: string;
    readonly overallScore: number; // 0 - 100
    readonly dimensions: ReadonlyArray<{
      readonly name: string;
      readonly score: number; // 1 - 5
      readonly justification: string;
    }>;
    readonly summary: string;
  };
  readonly compositeScore: number; // 0 - 100
  readonly passedBenchmark: boolean;
}
```

---

## 3. SQLite Local Index (`benchmarks.sqlite`)

To power fast aggregation and sub-second leaderboard generation without scanning thousands of JSON files, runs are automatically mirrored to an embedded SQLite database.

```sql
CREATE TABLE IF NOT EXISTS benchmark_runs (
  run_id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  category TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL,
  composite_score REAL NOT NULL,
  passed_benchmark INTEGER NOT NULL,
  wall_clock_ms INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cache_hit_ratio REAL NOT NULL,
  total_cost_usd REAL NOT NULL,
  total_turns INTEGER NOT NULL,
  error_count INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_query 
  ON benchmark_runs(scenario_id, skill_id, model_id);
```

---

## 4. Automated Reporting Pipeline

```
+-----------------------------------------------------------------------------------+
|                            Evaluation & Metric Scribe                             |
|                Writes .benchmarks/runs/<run-id>/[metrics|eval].json               |
+-----------------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------------+
|                            SQLite Index Synchronizer                              |
|                          Updates benchmarks.sqlite                                |
+-----------------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------------+
|                          Statistical Analysis Engine                              |
|  - Bootstrap Resampling (10,000 runs for 95% Confidence Intervals)                |
|  - Welch's Two-Sample t-test & Mann-Whitney U for p-value significance            |
|  - Elo / Bradley-Terry Rating Computation                                         |
+-----------------------------------------------------------------------------------+
                                      |
          +---------------------------+---------------------------+
          |                                                       |
          v                                                       v
+-----------------------------+                         +-----------------------------+
|    Markdown Leaderboard     |                         |   Interactive HTML Report   |
|   (docs/leaderboard.md)     |                         |   (.benchmarks/reports/)    |
+-----------------------------+                         +-----------------------------+
```

---

## 5. Statistical Significance Testing

When comparing a skill against a baseline control (e.g. `diagnosing-bugs` vs `vanilla`), differences in pass rate, duration, and cost are evaluated for statistical significance.

### 5.1 Bootstrap Resampling
For metrics with non-normal distributions (e.g. tool execution duration, turn counts), 95% Confidence Intervals are calculated via $B = 10,000$ bootstrap replications:

$$\hat{\theta}^*_b = \text{mean}(X^*_b), \quad b = 1, \dots, 10000$$

$$CI_{95\%} = \left[ \text{Quantile}_{0.025}(\hat{\theta}^*), \text{Quantile}_{0.975}(\hat{\theta}^*) \right]$$

### 5.2 Hypothesis Testing ($p$-value)
- **Continuous Metrics (Cost, Latency)**: Two-sample Welch's $t$-test (robust to unequal variances).
- **Binary Pass Rates**: Fisher's Exact Test or Two-Proportion Z-Test.
- An improvement is marked as statistically significant if $p < 0.05$.

---

## 6. Sample Generated Leaderboard (`leaderboard.md`)

```markdown
# 🏆 Agent Skill Benchmark Leaderboard

*Last Updated: 2026-08-24 07:30 UTC | Total Evaluated Runs: 450*

## Summary by Skill (All Categories)

| Skill | Category | Pass Rate (%) | Elo Rating | Avg Score | Mean Duration | Avg Cost ($) | Cache Hit Ratio |
|---|---|---|---|---|---|---|---|
| `diagnosing-bugs` | Debugging | **93.3%** (+18.3%)* | **1642** | 91.4 / 100 | 48.2s | $0.142 | 82.4% |
| `tdd` | Testing & QA | **90.0%** (+25.0%)* | **1610** | 89.2 / 100 | 54.1s | $0.185 | 78.1% |
| `safe-debug` | Debugging | 86.7% (+11.7%) | 1545 | 84.6 / 100 | 62.0s | $0.168 | 74.3% |
| `vanilla-control` | Baseline | 75.0% (Ref) | 1500 | 76.1 / 100 | 71.5s | $0.210 | 61.2% |

*\* Statistically significant improvement over vanilla control ($p < 0.05$).*
```

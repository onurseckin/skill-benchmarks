# 06. Implementation Roadmap and Milestones

## 1. Project Overview & Phased Roadmap

This document defines the phased implementation plan for the `skill-benchmarks` platform, dividing the development into six structured phases from core runtime sandboxing to automated CI/CD continuous benchmarking.

```
+-----------------------------------------------------------------------------------+
|                            Implementation Phases                                  |
|                                                                                   |
|  [ Phase 1: Core Harness & Sandboxing ]                                           |
|       │                                                                           |
|       ▼                                                                           |
|  [ Phase 2: Provider Adapters & Telemetry Engine ]                                |
|       │                                                                           |
|       ▼                                                                           |
|  [ Phase 3: Scenario Catalog & Fixture Suites ]                                   |
|       │                                                                           |
|       ▼                                                                           |
|  [ Phase 4: Dual-Layer Evaluation & Judge System ]                                |
|       │                                                                           |
|       ▼                                                                           |
|  [ Phase 5: Storage, Analytics & Leaderboard Generator ]                          |
|       │                                                                           |
|       ▼                                                                           |
|  [ Phase 6: CI/CD, Matrix Runner & Continuous Benchmarking ]                      |
+-----------------------------------------------------------------------------------+
```

---

## 2. Phase Breakdown and Deliverables

### Phase 1: Core Harness & Sandboxing Infrastructure
**Objective**: Build the foundational Bun runtime environment, ephemeral workspace sandboxing, tool handlers, and base agent loop.

- [ ] **1.1 Workspace Sandbox Manager**
  - Implement `SandboxedWorkspace` using Git worktrees and ephemeral directory mounting.
  - Add deterministic cleanup hooks and teardown lifecycle management.
  - Implement sub-millisecond process execution via `Bun.spawn` with strict timeout controls.
- [ ] **1.2 Standard Tool Suite**
  - Implement `run_command`, `read_file`, `write_file`, `edit_file_content`, `list_directory`, `grep_search`, `find_by_name`.
  - Enforce sandbox root containment (prevent directory traversal out of workspace root).
- [ ] **1.3 Base Agent Loop**
  - Implement turn loop with turn-limit, cost-limit, and timeout guards.
  - Context assembly and skill prompt injection abstraction.

---

### Phase 2: Provider Adapters & Telemetry Engine
**Objective**: Develop normalized streaming LLM adapters with microsecond telemetry, prompt cache tracking, and dynamic pricing calculation.

- [ ] **2.1 LLM Provider Adapters**
  - Anthropic Claude adapter with streaming, prompt caching, and thinking tokens.
  - OpenAI GPT-4o / o1 adapter with streaming and prefix caching.
  - Google Gemini adapter with streaming and context caching.
  - Generic OpenAI-compatible local adapter (Ollama/vLLM).
- [ ] **2.2 High-Resolution Telemetry Scribe**
  - Event emitter writing structured `events.jsonl` with microsecond timestamps.
  - Token consumption tracker (uncached input, cache creation, cache read, completion output, reasoning).
  - Dynamic pricing engine with centralized `pricing-catalog.json`.

---

### Phase 3: Benchmark Scenario Catalog & Fixtures
**Objective**: Create the declarative YAML schema validation engine and author representative benchmark suites grounded in `skill-list/skill-list.md`.

- [ ] **3.1 Scenario Validation Engine**
  - Zod parser for `scenario.yaml` specifications.
  - Fixture hydration and environment setup pipeline.
- [ ] **3.2 Initial Fixture Catalog (Grounding in `skill-list.md`)**
  - **Debugging**: `node-stream-backpressure-leak`, `golang-goroutine-deadlock` (Targeting `diagnosing-bugs`, `safe-debug`, `golang-troubleshooting`).
  - **Testing & QA**: `tdd-sliding-window-rate-limiter`, `playwright-flaky-e2e-stabilization` (Targeting `tdd`, `qa`, `webapp-testing`).
  - **Security**: `fastify-idor-tenant-isolation`, `jwt-algorithm-confusion-patch` (Targeting `firebase-security-rules-auditor`, `security-review`).
  - **Documentation**: `diataxis-api-reference-synthesis`, `adr-event-driven-architecture` (Targeting `documentation-writer`, `documentation-and-adrs`).
  - **Code Review**: `pr-concurrency-and-perf-audit` (Targeting `code-review`, `code-review-excellence`).

---

### Phase 4: Dual-Layer Evaluation & Judge Engine
**Objective**: Implement automated deterministic test/lint/diff checks alongside LLM-as-a-judge scoring and blind pairwise Elo tournaments.

- [ ] **4.1 Deterministic Evaluation Layer**
  - Test runner validator (`bun test`, `go test`, `pytest`) capturing exit codes and output streams.
  - AST diff analyzer and invariant verifier (ensuring test assertions were not maliciously tampered with).
- [ ] **4.2 LLM Judge Engine**
  - Impartial judge prompt builder with strict structured JSON output.
  - Multi-dimensional rubric scoring engine (1 to 5 Likert scale per dimension).
- [ ] **4.3 Blind Pairwise Tournament & Elo Rating Engine**
  - Position-debiased pairwise comparator (Permutation 1 [A vs B] and Permutation 2 [B vs A]).
  - Bradley-Terry model and Elo rating updater with Wilson score confidence intervals.

---

### Phase 5: Storage, Analytics & Leaderboard Generator
**Objective**: Build persistent storage indexing, statistical significance analysis, and automated markdown/HTML leaderboard generation.

- [ ] **5.1 Persistence & SQLite Mirror**
  - Atomic writing of `manifest.json`, `events.jsonl`, `metrics.json`, `evaluation.json`, `git.diff`.
  - SQLite synchronizer for instantaneous SQL aggregations across hundreds of benchmark runs.
- [ ] **5.2 Statistical Significance Engine**
  - Bootstrap resampling (10,000 replications) for confidence interval estimation.
  - Welch's $t$-test and Mann-Whitney U test calculating $p$-values against baseline controls.
- [ ] **5.3 Leaderboard Generators**
  - Automated `leaderboard.md` generator formatted for GitHub README and documentation.
  - Standalone interactive HTML dashboard with performance and cost visualizations.

---

### Phase 6: Matrix Runner, CI/CD & Continuous Benchmarking
**Objective**: CLI matrix orchestration and automated GitHub Actions benchmarking workflows.

- [ ] **6.1 Parallel Matrix CLI Runner**
  - Support multi-dimensional sweeps: `--scenarios`, `--skills`, `--models`, `--repeats`, `--concurrency`.
- [ ] **6.2 GitHub Actions CI Pipeline**
  - Automated benchmark regression gate on Pull Requests modifying skill prompts.
  - Scheduled nightly benchmarking runs tracking frontier model updates.

---

## 3. Milestone Delivery Timeline

| Milestone | Target | Key Acceptance Criteria |
|---|---|---|
| **M1: Harness Core** | Week 1 | Ephemeral sandbox executes commands in under 5ms; basic agent loop runs to completion with mock LLM. |
| **M2: Telemetry & Multi-Provider** | Week 2 | Full streaming support for Anthropic, OpenAI, and Gemini; exact prompt-cache token attribution and USD cost calculations verified. |
| **M3: Scenario Catalog** | Week 3 | 10+ scenario fixtures authored across 5 categories; declarative YAML schema parser fully passes validation tests. |
| **M4: Dual Evaluation** | Week 4 | Deterministic test checks and LLM judge rubrics pass integration tests; pairwise Elo tournament runs without position bias. |
| **M5: Analytics & Leaderboard** | Week 5 | SQLite indexing operational; automated Markdown and HTML leaderboards generated with bootstrap confidence intervals. |
| **M6: Continuous CI/CD** | Week 6 | End-to-end matrix runs executable via single CLI command; GitHub Actions benchmark workflow enabled. |

---

## 4. Technical Risks & Mitigations

| Risk / Challenge | Severity | Mitigation Strategy |
|---|---|---|
| **LLM Non-Determinism** | High | Run multi-repeat benchmark passes ($N \ge 3$) with temperature 0.0; report 95% Wilson confidence intervals. |
| **Position Bias in LLM Judges** | Medium | Enforce dual-permutation blind pairwise matches ($A \text{ vs } B$ and $B \text{ vs } A$); discard asymmetric flips as ties. |
| **Sandbox Contamination** | High | Use fresh Git worktrees and isolated scratch directories for every individual run; assert clean git status prior to execution. |
| **Prompt Cache Invalidation** | Medium | Construct message history with stable prefix order (system prompt $\rightarrow$ skill instructions $\rightarrow$ scenario context) to maximize provider cache hits. |
| **API Rate Limits / Flakiness** | Medium | Implement exponential backoff with jitter in provider adapters; concurrency pool throttles active requests per provider key. |

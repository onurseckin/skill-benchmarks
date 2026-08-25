# ⚡ Frontier AI Agent Skill Benchmark Suite

> Deterministic, high-throughput LLM agent skill evaluation framework. Benchmarks tool-calling capabilities, complex multi-file refactoring, concurrent systems programming, security exploit triage, and performance optimization across isolated Docker sandboxes with cgroups v2 resource metering, multi-judge consensus scoring, Bradley-Terry Elo rating tournaments, and property-based adversarial fuzzing.

[![Runtime](https://img.shields.io/badge/runtime-Bun_v1.3+-black?logo=bun&logoColor=white)](https://bun.sh)
[![Language](https://img.shields.io/badge/language-TypeScript_5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Sandboxing](https://img.shields.io/badge/sandboxing-Docker_cgroups_v2-2496ED?logo=docker&logoColor=white)](https://docker.com)
[![Telemetry](https://img.shields.io/badge/storage-SQLite_WAL-003B57?logo=sqlite&logoColor=white)](https://sqlite.org)
[![Quality](https://img.shields.io/badge/quality_gate-100%25_Verified-brightgreen)](#quality-gates--invariants)
[![License](https://img.shields.io/badge/license-MIT-purple)](#license)

---

## 📑 Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Quickstart Guide](#quickstart-guide)
- [CLI Command Reference](#cli-command-reference)
- [Pre-Computed Leaderboard Summary](#pre-computed-leaderboard-summary)
- [Subsystems Matrix (22 Core Domains)](#subsystems-matrix-22-core-domains)
- [Quality Gates & Invariants](#quality-gates--invariants)
- [Contributing](#contributing)

---

## 🔭 Overview

The **Frontier AI Agent Skill Benchmark Suite** (`skill-benchmarks`) provides an automated test harness to rigorously measure, rank, and stress-test autonomous LLM software engineering agents.

### Key Capabilities

- **Isolated Execution Sandboxing**: Executes agent tool calls inside isolated Docker containers with strict cgroups v2 memory, CPU, PID limits, and network firewalls.
- **Deterministic Multi-Turn Evaluator**: Evaluates agents across multi-turn trajectories with AST code inspection, semantic git diff matching, and terminal stdout assertion engines.
- **Bradley-Terry Elo Tournaments**: Organizes automated head-to-head blind matchmaking battles, updating Elo ratings across models and specialized agent skills.
- **Property-Based Adversarial Fuzzing**: Mutates scenarios, injects prompt perturbations, and stresses agent resilience under unpredictable conditions.
- **Chaos Fault Injection**: Deterministically injects network latency, 429 HTTP rate limits, memory spikes, file corruptions, and process terminations.
- **Time-Travel Replay & Live Streaming**: Records full execution state timelines with interactive ANSI TUI playback, standalone HTML replay exports, and real-time WebSocket PTY streaming.
- **Neo-Brutalist Dashboard & Analytics**: Interactive single-page dashboard with SVG capability radar charts, cost-efficiency Pareto frontiers, and statistical hypothesis testing (Welch t-test, Mann-Whitney U, Cohen's d).

---

## 🏛️ System Architecture

```
+===================================================================================================+
|                                    SKILL-BENCHMARKS ARCHITECTURE                                  |
+===================================================================================================+
|                                                                                                   |
|  [ USER INTERFACES & ENTRY POINTS ]                                                               |
|  +---------------------------+  +---------------------------+  +-------------------------------+  |
|  |     CLI Subsystem         |  |   REST & WebSocket Server |  |    Neo-Brutalist SPA UI       |  |
|  |  (commands, parser, TUI)  |  |   (REST API, SSE, WS PTY) |  |   (SVG Radar, Pareto, Dark)   |  |
|  +-------------+-------------+  +-------------+-------------+  +---------------+---------------+  |
|                |                              |                                |                  |
+----------------|------------------------------|--------------------------------|------------------+
|                v                              v                                v                  |
|  [ EXECUTION ORCHESTRATION LAYER ]                                                                |
|  +---------------------------------------------------------------------------------------------+  |
|  |  Matrix Sweep Engine  |  Tournament Matcher  |  Adversarial Fuzzer  |  Chaos Fault Injector |  |
|  |  Prompt Optimizer     |  Scenario Synthesizer|  Agent Dialog Harness|  PTY Stream Tunnel    |  |
|  +--------------------------------------------+------------------------------------------------+  |
|                                               |                                                   |
+-----------------------------------------------|---------------------------------------------------+
|                                               v                                                   |
|  [ RUNNER & SANDBOX INFRASTRUCTURE LAYER ]                                                        |
|  +--------------------------------------------+------------------------------------------------+  |
|  |  Multi-Turn Agent Runner  |  Skill Loader & Registry  |  Universal LLM Provider Adapters    |  |
|  |  (Tool Dispatch Loop)     |  (Markdown Skill Spec)    |  (Anthropic, OpenAI, Google)        |  |
|  +--------------------------------------------+------------------------------------------------+  |
|  |  Docker Sandbox Pool & Manager  |  cgroups v2 Resource Metering  |  Virtual PTY Multiplexer |  |
|  +--------------------------------------------+------------------------------------------------+  |
|                                               |                                                   |
+-----------------------------------------------|---------------------------------------------------+
|                                               v                                                   |
|  [ EVALUATION, TELEMETRY & PERSISTENCE LAYER ]                                                    |
|  +--------------------------------------------+------------------------------------------------+  |
|  |  Deterministic Eval Rubric|  AST Diff Parser |  Multi-Judge Consensus (G-Eval / Cohen Kappa)|  |
|  +--------------------------------------------+------------------------------------------------+  |
|  |  Statistical Analytics Engine (Welch, Mann-Whitney, Pareto) |  CI/CD GitHub Action Gates   |  |
|  +--------------------------------------------+------------------------------------------------+  |
|  |  SQLite WAL Database (`data/benchmark-results.db`) |  HTML & Markdown Leaderboard Exporters |  |
|  +---------------------------------------------------------------------------------------------+  |
+===================================================================================================+
```

---

## 🚀 Quickstart Guide

### 1. Prerequisites

- [Bun](https://bun.sh) (v1.3.0 or higher)
- [Docker](https://docs.docker.com/get-docker/) (for isolated container sandboxing)
- API keys for evaluated model providers

### 2. Installation

Clone the repository and install dependencies with Bun:

```bash
git clone https://github.com/onurseckin/skill-benchmarks.git
cd skill-benchmarks
bun install
```

### 3. Configure Provider API Keys

Set your environment variables for the foundation models you plan to benchmark:

```bash
export ANTHROPIC_API_KEY="sk-ant-api03-..."
export OPENAI_API_KEY="sk-proj-..."
export GEMINI_API_KEY="AIzaSy..."
```

### 4. Execute Your First Benchmark

Run a single benchmark evaluation comparing an agent skill against a standard scenario:

```bash
bun cli run --scenario git-worktrees --skill using-git-worktrees --model claude-3-5-sonnet-20241022
```

### 5. Launch the Interactive Dashboard

Start the local server and open the live telemetry UI:

```bash
bun cli server --port 3000
```

Open `http://localhost:3000` in your browser to inspect interactive radar charts, cost-latency Pareto curves, and session replays.

---

## 🛠️ CLI Command Reference

The `skill-benchmarks` CLI provides a unified interface for all benchmarking operations.

```bash
bun run bin/skill-benchmarks <command> [options]
```

### Subcommands Table

| Command | Syntax | Primary Flags | Description |
| :--- | :--- | :--- | :--- |
| `run` / `bench` | `bun cli run` | `-s, --scenario`, `-k, --skill`, `-m, --model`, `-j, --concurrency` | Executes skill benchmark runs across specified scenarios, skills, and models. |
| `sweep` | `bun cli sweep` | `-s, --scenario`, `-k, --skill`, `-m, --model`, `--timeout` | Runs an exhaustive Cartesian matrix sweep over scenarios, skills, and model combinations. |
| `tournament` | `bun cli tournament` | `-k, --skill`, `-s, --scenario`, `--k-factor`, `--max-matches` | Organizes automated paired Elo tournaments, calculating Bradley-Terry skill ratings. |
| `report` | `bun cli report` | `-f, --format [console\|markdown\|html\|json]`, `-o, --output` | Generates formatted leaderboard summaries and dashboards from telemetry databases. |
| `replay` | `bun cli replay` | `--target <file.json\|run-id>`, `--live`, `--speed <N>`, `--web` | Plays back recorded agent executions with interactive ANSI TUI or exports standalone HTML. |
| `server` | `bun cli server` | `--port <PORT>`, `--host <HOST>`, `--db <PATH>` | Launches high-throughput REST and WebSocket live streaming telemetry server. |
| `fuzz` | `bun cli fuzz` | `-s, --scenario`, `--mutations <N>`, `--strategies`, `--seed <N>` | Executes property-based adversarial fuzzing suites to test agent resilience under perturbation. |
| `arena` | `bun cli arena` | `-m, --model`, `-s, --scenario`, `--judge-model`, `--rounds` | Runs head-to-head blind battles evaluated by multi-judge consensus rubrics. |
| `generate` | `bun cli generate` | `--category <CAT>`, `--difficulty <DIFF>`, `-o, --output` | Synthesizes synthetic benchmark scenarios, testbeds, and ground-truth validators. |
| `chaos` | `bun cli chaos` | `-s, --scenario`, `--faults <latency,429,sigkill>`, `--intensity` | Injects deterministic network, filesystem, process, and rate-limit chaos during execution. |
| `sync` | `bun cli sync` | `--catalog <PATH>`, `--target-dir <DIR>`, `--force` | Synchronizes, validates, and registers agent skills into the local registry catalog. |
| `list` | `bun cli list` | `--target [all\|scenarios\|skills]` | Lists all available benchmark scenarios, categories, difficulty levels, and skills. |

---

## 🏆 Pre-Computed Leaderboard Summary

Benchmark trials evaluated across 8 engineering domains (120 total runs) generated the following baseline ratings:

### Foundation Model Leaderboard

| Rank | Foundation Model | Provider | Elo Rating | Pass@1 Rate | Avg Score | Mean Latency | Avg Cost / Task | Cache Hit | Evaluated Runs |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 🥇 1 | `claude-3-5-sonnet-20241022` | Anthropic | **1648** | **100.0%** | **93.7 / 100** | 40.3s | $0.1184 | **87.9%** | 40 |
| 🥈 2 | `gpt-4o-2024-11-20` | OpenAI | 1532 | 90.0% | 86.3 / 100 | **36.3s** | $0.1266 | 75.6% | 40 |
| 🥉 3 | `gemini-1.5-pro-002` | Google | 1420 | 57.5% | 80.6 / 100 | 48.1s | **$0.0627** | 71.8% | 40 |

### Domain Category Champions

| Category | Champion Skill | Benchmark Scenario | Pass Rate | Elo Rating | Mean Score |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **Coding** | `using-git-worktrees` | Isolated Worktree Feature Branching | 80.0% | 1544 | 86.8 / 100 |
| **Frontend** | `a11y-debugging` | WCAG 2.1 AA Accessibility Remediation | 93.3% | 1542 | 87.3 / 100 |
| **React** | `vercel-composition-patterns` | React Compound Component Refactoring | 80.0% | 1541 | 87.1 / 100 |
| **Debugging** | `memory-leak-debugging` | Event Stream Closure Leak Fix | 93.3% | 1540 | 87.7 / 100 |
| **System** | `golang-pro` | Bounded Concurrency Worker Pool | 73.3% | 1538 | 85.4 / 100 |
| **Composite** | `fullstack-refactor` | Fullstack React, Go & Docker Refactor | 86.7% | 1537 | 87.7 / 100 |
| **Security** | `security-triage` | Cross-Boundary Polyglot Exploit Triage | 86.7% | 1536 | 87.2 / 100 |
| **Optimization**| `performance-optimization` | Zero-Alloc Streaming Data Pipeline | 66.7% | 1535 | 85.6 / 100 |

*Complete data and breakdowns available in [`docs/LEADERBOARD.md`](docs/LEADERBOARD.md) and [`data/leaderboard.md`](data/leaderboard.md).*

---

## 🧩 Subsystems Matrix (22 Core Domains)

The codebase is organized into 22 decoupled domain modules located under `src/`:

| # | Subsystem | Module Path | Core Responsibilities |
| :---: | :--- | :--- | :--- |
| 1 | **Analytics** | `src/analytics/` | Statistical hypothesis testing (Welch t-test, Mann-Whitney U, Cohen's d), Pareto frontiers, radar charts. |
| 2 | **Arena** | `src/arena/` | Head-to-head agent battles, Bradley-Terry Elo rating engine, matchmaking queue, battle royale tournaments. |
| 3 | **Chaos** | `src/chaos/` | Deterministic fault injection (network latency, 429 rate limits, filesystem corruption, process kill). |
| 4 | **CI/CD** | `src/ci/` | GitHub Actions quality gates, PR comment bot, JUnit / SARIF report exporters, regression threshold enforcers. |
| 5 | **CLI** | `src/cli/` | Interactive & headless CLI suite, ANSI styling, formatted tables, metric cards, progress bars, flag parser. |
| 6 | **Dashboard UI** | `src/dashboard-ui/` | Standalone Neo-Brutalist SPA dashboard, SVG radar/Pareto charts, filtering, search, dark mode. |
| 7 | **Dialog** | `src/dialog/` | Multi-turn interactive human-in-the-loop harness, prompt injection evaluation, clarification handling. |
| 8 | **Evaluation** | `src/eval/` | Deterministic multi-dimensional evaluation rubric, AST code analysis, semantic diff matching, terminal validators. |
| 9 | **Fuzzer** | `src/fuzzer/` | Property-based adversarial mutator, semantic prompt perturbations, edge-case generation, resilience scoring. |
| 10 | **Generator** | `src/generator/` | Synthetic scenario synthesizer, testbed scaffold generator, automated ground-truth validator synthesis. |
| 11 | **Infrastructure** | `src/infrastructure/` | Isolated Docker sandbox environments, container pooling, cgroups v2 resource metering, garbage collector. |
| 12 | **Judge** | `src/judge/` | Multi-judge consensus (LLM-as-a-Judge), judge calibration, G-Eval framework, Cohen's Kappa agreement. |
| 13 | **Optimizer** | `src/optimizer/` | Hyperparameter optimizer, token budget controller, DSPy-style teleprompter, cost-latency optimizer. |
| 14 | **Providers** | `src/providers/` | Universal LLM adapters (Anthropic, OpenAI, Google Gemini, Ollama, DeepSeek), token accounting, rate limits. |
| 15 | **Replay** | `src/replay/` | High-fidelity deterministic execution replay engine, full state timeline recorder, ANSI TUI player, web export. |
| 16 | **Reporting** | `src/reporting/` | Multi-format reporting engine (Markdown leaderboard, Neo-Brutalist HTML dashboard, JSON), SQLite telemetry DB. |
| 17 | **Runner** | `src/runner/` | Core execution engine, multi-turn tool-calling loop, container lifecycle execution, step timeout enforcement. |
| 18 | **Scenarios** | `scenarios/` | Curated real-world software engineering benchmark scenarios across 8 engineering domains. |
| 19 | **Server** | `src/server/` | High-throughput REST & WebSocket API server, live dashboard backend, background benchmark queue. |
| 20 | **Skills** | `src/skills/` | Agent skill catalog loader, registry, markdown parser, prompt injection validator, dependency manager. |
| 21 | **Streaming** | `src/streaming/` | SSE and WebSocket telemetry streaming, live event pub/sub bus, backpressure handling, terminal frames. |
| 22 | **Tunnel** | `src/tunnel/` | Virtual PTY stream multiplexer, Docker container exec stream bridge, ANSI escape sequence handler. |

---

## 🛡️ Quality Gates & Invariants

This repository enforces strict, automated invariants verified by the quality gate script (`bun run src/scripts/quality-gate.ts`):

1. **Zero Comments Invariant**: Source code files contain 0 comments (no `//`, `/* */`, JSDoc, or Python `#`). Type systems, domain naming, and code structure are strictly self-documenting.
2. **Strict 400-Line File Ceiling**: Every source code file remains strictly under 400 lines of code to prevent sprawl and enforce modular separation of concerns.
3. **Zero TypeScript `any` & Zero Suppressions**: 0 `any` annotations, 0 `@ts-ignore`, 0 `@ts-expect-error`, and 0 `eslint-disable` directives throughout the entire codebase.
4. **Mandatory Typecheck & Verification**: Enforced via `bun run typecheck` and `bun run src/scripts/quality-gate.ts`.

To verify compliance locally:

```bash
bun run typecheck
bun run src/scripts/quality-gate.ts
```

---

## 📄 License

MIT © [Onur Seckin Senoglu](https://github.com/onurseckin)

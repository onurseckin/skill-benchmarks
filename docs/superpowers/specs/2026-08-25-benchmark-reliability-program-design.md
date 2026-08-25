# Benchmark Reliability Program Design

## Goal

Turn the repository into a trustworthy, offline-first benchmark harness that can run deterministic fake-provider benchmarks in isolated workspaces today and safely enable Anthropic, OpenAI, and Google live providers when credentials are supplied later.

## Problem Statement

The current project compiles but does not provide reliable operational evidence. Provider mode selection is implicit, the CLI ignores several advertised flags, fake providers are nondeterministic, tool calls can reach the host checkout, and runtime evidence is split between unrelated locations. Reports can label errored fake runs as passes and omit failures entirely. Documentation and CI also describe interfaces that the executable does not support.

## Scope

The program is divided into independently shippable reliability capsules. Each capsule ends with strict typechecking, the repository quality gate, deterministic runtime checks, a focused review, and an atomic commit and push. The controller repeats audit, implementation, verification, and repair rounds until no scoped reliability findings remain.

### Capsule 1: Offline Execution Contract

Create one resolved execution configuration used by every CLI entry point, sweep, arena participant, and judge. `SKILL_BENCHMARKS_USE_MOCK` is a strict boolean with a default of `true`. `--mock` selects fake mode and `--live` selects live mode. Contradictory command-line inputs fail with an argument error. Live mode requires a nonblank credential for the selected provider before any request starts. A provided API key never changes a fake execution into a live execution implicitly.

Fake providers use deterministic scripted responses, valid tool schemas, deterministic IDs, and explicit zero actual cost. Every result records `executionMode`, effective provider identity, and whether metrics are simulated. The reporting layer must retain this provenance and must never present a simulated run as a live measurement.

### Capsule 2: Isolated Workspace and Artifact Contract

Every benchmark receives a new run workspace. Fake mode may use a disposable local workspace created under the benchmark output root so it remains runnable before a Docker image is available. Live mode requires the Docker sandbox and fails clearly if Docker or the selected image is unavailable. Neither mode may fall back to the repository checkout or inherit provider credentials in model-directed commands.

All runtime evidence belongs under a single configurable output root, defaulting to `.benchmarks`:

```text
.benchmarks/
  db/benchmarks.sqlite
  runs/<run-id>/
    manifest.json
    events.jsonl
    transcript.jsonl
    raw.log
    metrics.json
    evaluation.json
    git.diff
    diff-manifest.json
    result.json
  sweeps/<sweep-id>/
    manifest.json
    checkpoint.json
    summary.json
    run-ids.json
  exports/<report-id>/
    report.json
    leaderboard.md
    dashboard.html
    report-card.html
    report-card.svg
```

Per-run artifacts are immutable evidence. SQLite is an index over that evidence, not the sole source of truth. Generated output is ignored by Git; repository-owned demonstration data remains explicit and separate from CLI output.

### Capsule 3: Honest Results, Reporting, and Replay

The sweep persists every terminal cell, including failures, timeouts, aborts, and errors. A run cannot be marked passed solely because a model produced final text. Result status, evaluation status, scenario category, simulation provenance, metric summaries, and typed telemetry are saved consistently.

Reporting opens existing databases read-only. It applies all documented filters, rejects a missing database rather than creating one, writes exports atomically beneath the output root, and emits JSON without ANSI or progress noise. Replay consumes the same typed event envelope written by the runner so a saved `events.jsonl` reproduces timestamps, tool records, and resource samples.

### Capsule 4: CLI, Documentation, CI, and Testbed Truthfulness

The CLI exposes only commands and flags that execute, validates input boundaries, provides stable exit codes, and respects TTY and `NO_COLOR`. A `doctor` workflow reports mode, credential availability without exposing secrets, Docker readiness, configured paths, and catalog health.

The README, usage guides, workflow configuration, and testbed start path are aligned with real commands. The quality gate covers all repository source formats in scope while retaining the no-comments and fewer-than-400-lines constraints. The testbed declares and installs the dependencies it executes.

## Architecture

The CLI resolves a `BenchmarkExecutionConfig` before it constructs a sweep, arena, tournament, or provider. The config owns execution mode, output root, sandbox policy, provider selections, and safe subprocess environment. Provider construction receives only this resolved configuration, so direct constructor bypasses are removed or made internal.

The execution coordinator creates a `RunArtifactLayout` and isolated `RunWorkspace` before model turns begin. It hands the same layout to the workspace, event scribe, evaluator, database writer, replay exporter, and report writer. Each component owns one concern and uses typed records rather than reconstructing facts from console output.

```text
CLI arguments and environment
  -> execution config resolver
  -> sweep or arena coordinator
  -> run artifact layout and isolated workspace
  -> provider adapter and runner
  -> typed events, result evidence, evaluation
  -> SQLite index and report or replay export
```

## Safety Rules

- Fake mode is the default and performs no provider network request.
- Live mode is deliberate, credential-validated, provider-specific, and sandbox-required.
- Provider keys, authorization headers, and sensitive environment values are redacted before logs, artifacts, errors, telemetry, reports, and API responses.
- Tool execution receives an explicit allowlisted environment and never falls back to the repository checkout.
- A failed tool call, missing evaluator, or incomplete evidence cannot yield a benchmark pass.
- Every source file remains below 400 lines and contains no source comments.
- No unit tests are added; verification uses strict typechecking, the quality gate, deterministic CLI executions, and Docker-backed smoke checks when available.

## Delivery Order

1. Establish the offline execution contract and deterministic fake baseline.
2. Route all run state through the isolated workspace and artifact contract.
3. Make results, reports, and replay evidence complete and truthful.
4. Align the CLI, docs, CI, and testbed with the implemented contract.
5. Repeat the controller loop with fresh independent audits for provider integration, runtime isolation, output usability, and code health.

## Non-Goals

This program does not issue live API calls without an explicit live-mode choice and valid credentials. It does not preserve obsolete flags or misleading compatibility behavior. It does not modify or remove the repository's `.olt` directory.

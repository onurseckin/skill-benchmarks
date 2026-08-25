# CLI Command Reference

[Configuration](../getting-started/configuration.md) | [Single trial](../running-benchmarks/single-trial.md)

Use the installed package entry point:

```bash
bun run cli -- <command> [options]
```

The public commands are `run`, `arena`, `tournament`, `report`, `list`, `replay`, `help`, and `version`. Unknown commands, flags, targets, duplicate scalar options, malformed values, and command-inapplicable options exit nonzero before command execution.

## `run`

`run` executes an admitted matrix of scenarios, substantive skills, models, and repetitions. Fake execution is the default.

```bash
bun run cli -- run \
  --mock \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o \
  --output-dir .benchmarks
```

| Option | Meaning |
| --- | --- |
| `-s`, `--scenario <ids>` | Scenario ID or comma-separated unique IDs |
| `-k`, `--skill <ids>` | Skill ID or comma-separated unique IDs |
| `-m`, `--model <ids>` | Model ID or comma-separated unique IDs |
| `-p`, `--provider <id>` | Exact model provider |
| `-c`, `--category <name>` | Scenario category |
| `-j`, `--concurrency <n>` | Positive integer parallelism |
| `-r`, `--repetitions <n>` | Positive integer repetitions |
| `--temperature <number>` | Finite model temperature |
| `--thinking <level>` | `none`, `low`, `medium`, `high`, or `max` |
| `--reasoning <level>` | `low`, `medium`, or `high` |
| `--thinking-budget <n>` | Nonnegative integer thinking budget |
| `--matrix-thinking <levels>` | Comma-separated unique thinking levels |
| `--timeout <seconds>` | Positive wall-clock limit with millisecond precision |
| `--max-turns <n>` | Positive integer turn limit |
| `--max-cost <usd>` | Nonnegative finite cost limit |
| `--mock` | Deterministic fake execution |
| `--live` | Provider-backed execution |
| `--dry-run` | Plan the admitted matrix without cell execution |
| `--output-dir <path>` | Runtime output root |
| `--db <path>` | SQLite evidence database |

Array selectors may repeat and merge when every normalized value remains unique. Scalar and boolean options may appear once. `--mock` and `--live` conflict.

## `arena`

`arena` requires one scenario, one skill, and exactly two distinct models in `--arena`. It emits only planned or unranked diagnostic facts.

```bash
bun run cli -- arena \
  --dry-run \
  --scenario git-worktrees \
  --skill tdd \
  --arena gpt-4o,claude-3-7-sonnet-20250219 \
  --output arena-plan.json
```

The retained controls are `--scenario`, `--skill`, `--arena`, `--dry-run`, `--mock`, `--live`, `--output-dir`, and `--output`.

## `tournament`

`tournament` requires at least one scenario, one skill, and at least two distinct models. It emits planned or unranked diagnostic schedules.

```bash
bun run cli -- tournament \
  --dry-run \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o,claude-3-7-sonnet-20250219 \
  --tournament-mode round-robin
```

The retained controls are `--scenario`, `--skill`, `--model`, `--tournament-mode`, `--rounds`, `--dry-run`, `--mock`, `--live`, `--output-dir`, and `--output`.

## `report`

`report` requires an existing SQLite database and reads it without creating a missing file.

```bash
bun run cli -- report \
  --db .benchmarks/db/benchmarks.sqlite \
  --format markdown \
  --output .benchmarks/exports/leaderboard.md
```

`--format` accepts `console`, `json`, `markdown`, or `html`. JSON without `--output` writes exactly one JSON document to stdout. JSON with an output path leaves stdout empty. Markdown and HTML require `--output`; console rejects it.

Query filters are `--scenario`, `--category`, `--skill`, `--model`, `--provider`, `--status`, `--execution-mode`, `--simulated`, `--authority`, `--cohort`, `--eligibility`, `--evaluation-status`, `--evidence-status`, `--from-date`, and `--to-date`. Evidence-backed cost facts use `--include-cost`. A report card requires both `--export-card <svg|html>` and `--card-output <path>`.

## `list`

`list` accepts one optional target: `scenarios`, `skills`, or `all`. It defaults to `all` and has no filter or machine-format flags.

```bash
bun run cli -- list scenarios
```

## `replay`

`replay` reads persisted evidence from either one direct JSONL/JSON target or a canonical `--run-id` with `--db` and `--output-dir`.

```bash
bun run cli -- replay .benchmarks/runs/<run-id>/events.jsonl --format json
```

`--format` accepts `tui`, `json`, or `html`. JSON writes one document to stdout unless `--output` is supplied. HTML requires `--output`. TUI requires an interactive terminal, rejects output files, and alone accepts `--speed` from `0.1` through `20`.

## Help and version

```bash
bun run cli -- --help
bun run cli -- help replay
bun run cli -- replay --help
bun run cli -- --version
```

Global help and version output are deterministic plain text. Public errors have stable safe diagnostic codes on stderr and never print raw exception details.

## Runtime output

`run` creates `db/`, `runs/`, and `sweeps/` below its output root. `exports/` contains only requested derived outputs. Fake and dry-run records remain simulated and unevaluated unless complete eligible evaluation evidence exists.

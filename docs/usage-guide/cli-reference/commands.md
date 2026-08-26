# CLI Command Reference

[Usage guide](../README.md) | [Configuration](../getting-started/configuration.md) | [Command discovery](interactive-shell.md)

Use the public checkout entry point:

```bash
bun run cli -- <command> [options]
```

Unknown commands, flags, targets, duplicate scalar options, malformed values, and command-inapplicable options exit nonzero before command execution. Array options may repeat and merge only when every normalized value remains unique.

## On this page

- [`run`](#run)
- [`arena`](#arena)
- [`tournament`](#tournament)
- [`report`](#report)
- [`list`](#list)
- [`replay`](#replay)
- [Help and version](#help-and-version)

## `run`

```text
skill-benchmarks run [options] [scenario-ids...]
```

`--skill` is required. Scenarios may be positional or selected with `--scenario`; the default is `git-worktrees`. The current default model is `claude-3-7-sonnet-20250219`. Fake execution is the default.

| Option                         | Constraint                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `-s`, `--scenario <values>`    | Scenario ID or comma-separated unique IDs                                          |
| `-k`, `--skill <values>`       | Required skill ID or comma-separated unique IDs                                    |
| `-m`, `--model <values>`       | Model ID or comma-separated unique IDs                                             |
| `-p`, `--provider <id>`        | `anthropic`, `openai`, `google`, `ollama`, or `custom`; must match selected models |
| `-c`, `--category <name>`      | Select a category or constrain every explicit scenario                             |
| `-j`, `--concurrency <number>` | Integer at least 1                                                                 |
| `-r`, `--repetitions <number>` | Integer at least 1                                                                 |
| `--temperature <number>`       | Finite number                                                                      |
| `--thinking <value>`           | `none`, `low`, `medium`, `high`, or `max`                                          |
| `--reasoning <value>`          | `low`, `medium`, or `high`                                                         |
| `--thinking-budget <number>`   | Nonnegative integer                                                                |
| `--matrix-thinking <values>`   | Unique thinking-level list                                                         |
| `--timeout <seconds>`          | Positive value with millisecond precision                                          |
| `--max-turns <number>`         | Integer at least 1                                                                 |
| `--max-cost <usd>`             | Nonnegative finite value                                                           |
| `--mock`                       | Select deterministic fake execution                                                |
| `--live`                       | Select provider-backed execution                                                   |
| `--dry-run`                    | Run the admitted matrix without provider cell execution                            |
| `--output-dir <path>`          | Runtime output root                                                                |
| `--db <path>`                  | SQLite evidence database                                                           |
| `--help`                       | Show run grammar                                                                   |

`--mock` and `--live` conflict. Dry-run records are still simulated diagnostic records and may create runtime artifacts.

```bash
bun run cli -- run --mock --scenario git-worktrees --skill tdd --model gpt-4o
```

## `arena`

Arena requires exactly one scenario, exactly one skill, and exactly two distinct models in `--arena`.

| Option                | Constraint                                                           |
| --------------------- | -------------------------------------------------------------------- |
| `--scenario <values>` | Exactly one scenario                                                 |
| `--skill <values>`    | Exactly one skill                                                    |
| `--arena <values>`    | Exactly two distinct models                                          |
| `--dry-run`           | Emit a planned, unranked pairing                                     |
| `--mock`              | Run both fake candidates; result remains simulated and unranked      |
| `--live`              | Unavailable comparison mode; fails closed before candidate execution |
| `--output-dir <path>` | Diagnostic runtime root                                              |
| `--output <path>`     | Diagnostic JSON output                                               |
| `--help`              | Show arena grammar                                                   |

```bash
bun run cli -- arena \
  --dry-run \
  --scenario git-worktrees \
  --skill tdd \
  --arena gpt-4o,claude-3-7-sonnet-20250219
```

Arena does not produce a winner, rating, or ranking.

## `tournament`

Tournament requires one or more scenarios, exactly one skill, and at least two distinct models.

| Option                     | Constraint                                                           |
| -------------------------- | -------------------------------------------------------------------- |
| `--scenario <values>`      | One or more unique scenarios                                         |
| `--skill <values>`         | Exactly one skill                                                    |
| `--model <values>`         | At least two distinct models                                         |
| `--tournament-mode <mode>` | `round-robin` or `swiss`                                             |
| `--rounds <number>`        | Positive integer within the selected mode's derived limit            |
| `--dry-run`                | Emit a planned, unranked schedule                                    |
| `--mock`                   | Run fake pairings; result remains simulated and unranked             |
| `--live`                   | Unavailable comparison mode; fails closed before candidate execution |
| `--output-dir <path>`      | Diagnostic runtime root                                              |
| `--output <path>`          | Diagnostic JSON output                                               |
| `--help`                   | Show tournament grammar                                              |

The default mode is round-robin for six or fewer models and Swiss for more than six. A Swiss plan materializes round one and identifies later round numbers as unplanned; it is not a completed Swiss competition.

```bash
bun run cli -- tournament \
  --dry-run \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o,claude-3-7-sonnet-20250219 \
  --tournament-mode round-robin
```

## `report`

`report` requires an existing file supplied with `--db`. A missing database is rejected without creating it.

| Option                         | Constraint                                                          |
| ------------------------------ | ------------------------------------------------------------------- |
| `--db <path>`                  | Required existing SQLite database                                   |
| `--format <format>`            | `console`, `json`, `markdown`, or `html`; default `console`         |
| `--output <path>`              | Required for Markdown/HTML; optional for JSON; rejected for console |
| `--scenario <values>`          | Scenario filters                                                    |
| `--category <values>`          | Category filters                                                    |
| `--skill <values>`             | Skill filters                                                       |
| `--model <values>`             | Model filters                                                       |
| `--provider <values>`          | Provider filters                                                    |
| `--status <values>`            | `completed`, `failed`, `timed_out`, `aborted`                       |
| `--execution-mode <values>`    | `fake` or `live`                                                    |
| `--simulated <value>`          | `true` or `false`                                                   |
| `--authority <value>`          | `eligible` or `diagnostic`                                          |
| `--cohort <values>`            | `eligible`, `validation`, or `operational`                          |
| `--eligibility <values>`       | `eligible`, `ineligible`, or `unknown`                              |
| `--evaluation-status <values>` | `not_requested`, `not_evaluated`, `evaluated`, or `invalid`         |
| `--evidence-status <values>`   | `unavailable`, `collecting`, `complete`, or `invalid`               |
| `--from-date <timestamp>`      | Inclusive parseable timestamp                                       |
| `--to-date <timestamp>`        | Inclusive parseable timestamp, not before `--from-date`             |
| `--title <text>`               | HTML report title                                                   |
| `--include-cost`               | Include verified eligible cost facts only                           |
| `--export-card <format>`       | `svg` or `html`                                                     |
| `--card-output <path>`         | Required with `--export-card`                                       |
| `--help`                       | Show report grammar                                                 |

JSON without `--output` writes exactly one JSON document to stdout. JSON with an output path leaves stdout empty. Markdown and HTML require an output path. Console rejects one.

A report card additionally requires one exact skill filter and exactly one eligible skill cohort. It fails against fake-only diagnostic evidence.

## `list`

```text
skill-benchmarks list [scenarios|skills|all]
```

The optional target defaults to `all`. The only command option is `--help`. There are no model, filter, or JSON options.

## `replay`

Choose exactly one source form:

1. One direct positional `.jsonl` or `.json` target, or the equivalent `--target <path>`.
2. One canonical `--run-id` together with `--db` and `--output-dir`.

Do not mix direct and canonical source forms. A direct source validates its own persisted content but does not establish database, manifest, and result identity.

| Option                | Constraint                                             |
| --------------------- | ------------------------------------------------------ |
| `--target <path>`     | Direct `.jsonl` or replay `.json` source               |
| `--run-id <id>`       | Canonical persisted run ID                             |
| `--db <path>`         | Existing canonical database                            |
| `--output-dir <path>` | Canonical runtime root                                 |
| `--format <format>`   | `tui`, `json`, or `html`; default `tui`                |
| `--output <path>`     | Optional for JSON, required for HTML, rejected for TUI |
| `--speed <number>`    | TUI only, from 0.1 through 20                          |
| `--help`              | Show replay grammar                                    |

TUI requires an interactive terminal. JSON writes one document to stdout unless `--output` is supplied. HTML requires `--output`. An output path must not collide with the direct source or canonical events, manifest, result, or database paths.

## Help and version

```bash
bun run cli -- --help
bun run cli -- help replay
bun run cli -- replay --help
bun run cli -- --version
bun run cli -- version
```

`help` accepts one optional command name from the public command set. `version` accepts no command option. Do not use `help --help` or `version --help`.

Public errors use stable safe diagnostic codes on stderr. When output is piped, normal command output contains no terminal escape sequences.

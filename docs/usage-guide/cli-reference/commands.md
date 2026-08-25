# CLI Command Manual

[Previous: Configuration](../getting-started/configuration.md) | [Table of Contents](../README.md) | [Next: Interactive Shell](interactive-shell.md)

This document provides a comprehensive command-line reference for the Agent Skill Benchmarks CLI (`bun run src/cli/index.ts`).

---

## 1. Global Command Overview

The CLI provides entry points for running single trials, orchestrating matrix sweeps, managing skill registries, replaying execution traces, generating reports, and stress testing scenarios with fuzzing.

```bash
bun run src/cli/index.ts <command> [options]
```

### Supported Commands

| Command | Aliases | Description |
| :--- | :--- | :--- |
| `run` | `bench` | Execute a benchmark trial or full parameter sweep |
| `arena` | — | Execute head-to-head model matches with blind judge & Elo updates |
| `tournament` | — | Run an Elo-rated tournament across skill pairs |
| `report` | — | Generate aggregated leaderboards, HTML dashboards, and SVG badges |
| `sync` | — | Download, index, and validate skills from the catalog |
| `list` | — | List available scenarios, skills, models, or categories |
| `replay` | — | Replay recorded trajectory frames in TUI or export to Web/HTML |
| `fuzz` | — | Execute adversarial scenario mutations and boundary tests |
| `help` | `-h`, `--help` | Display CLI help and usage instructions |
| `version` | `--version` | Display the current platform version |

---

## 2. Command Reference

### `arena`
Execute head-to-head model matches on a single benchmark scenario with double-blind judging and live Elo rating updates.

```bash
bun run src/cli/index.ts arena --model claude-3-7-sonnet,o3-mini --scenario git-worktrees
```

#### Options & Flags

| Flag | Short Alias | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `--model` | `-m` | `string[]` | `["claude-3-7-sonnet", "o3-mini"]` | The two models competing in the arena |
| `--scenario` | `-s` | `string` | `git-worktrees` | Benchmark scenario to execute |
| `--judge-model` | — | `string` | `claude-3-7-sonnet` | Model to serve as the blind pairwise judge |
| `--k-factor` | — | `number` | `32` | Bradley-Terry Elo K-factor |
| `--db-path` | `--db` | `string` | `./benchmarks.db` | Target SQLite telemetry database path |

---

### `run` / `bench`
Execute a single benchmark trial or multi-dimensional matrix sweep across scenarios, skills, and models.

```bash
bun run src/cli/index.ts run [options]
```

#### Options & Flags

| Flag | Short Alias | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `--scenario` | `-s` | `string[]` | `["git-worktrees"]` | Comma-separated scenario IDs or repeated flags |
| `--skill` | `-k` | `string[]` | `["using-git-worktrees"]` | Comma-separated skill IDs or repeated flags |
| `--model` | `-m` | `string[]` | `["claude-3-7-sonnet"]` | Comma-separated model IDs to benchmark |
| `--provider` | `-p` | `string` | Inferred from model | Force specific provider (`anthropic`, `openai`, `deepseek`, `gemini`, `groq`, `ollama`) |
| `--concurrency`| `-j` | `number` | `2` | Maximum concurrent trial workers |
| `--repetitions`| `-r` | `number` | `1` | Number of repeated runs per cell for variance estimation |
| `--temperature`| — | `number` | `0.0` | Sampling temperature for model inference |
| `--timeout` | — | `number` | `300` | Timeout in seconds per trial |
| `--max-turns` | — | `number` | `15` | Maximum agent turns before trial cutoff |
| `--max-cost` | — | `number` | `1.00` | Maximum cost ceiling in USD per trial |
| `--db-path` | `--db` | `string` | `./benchmarks.db` | Target SQLite telemetry database path |
| `--clean-sandbox` | — | `boolean` | `true` | Teardown sandbox directories after execution |
| `--skip-judge` | — | `boolean` | `false` | Skip subjective LLM judge evaluation |
| `--verbose` | `-v` | `boolean` | `false` | Enable verbose real-time event logging |

#### Examples

```bash
# Run a single trial on git-worktrees with Claude 3.7 Sonnet
bun run src/cli/index.ts run -s git-worktrees -k using-git-worktrees -m claude-3-7-sonnet

# Run a 2x2 matrix sweep with 4 concurrent workers
bun run src/cli/index.ts run \
  -s git-worktrees,memory-leak \
  -k using-git-worktrees,systematic-debugging \
  -m claude-3-7-sonnet,gpt-4o \
  -j 4 --db-path data/benchmark-results.db
```

---

### `tournament`
Execute pairwise Elo tournament matches between agent skills across benchmark scenarios.

```bash
bun run src/cli/index.ts tournament [options]
```

#### Options & Flags

| Flag | Short Alias | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `--scenario` | `-s` | `string[]` | `["git-worktrees"]` | Scenarios to evaluate in tournament |
| `--skill` | `-k` | `string[]` | `["using-git-worktrees", "generic-agent"]` | Skill IDs competing in the tournament |
| `--k-factor` | — | `number` | `32` | Elo K-factor determining rating volatility |
| `--initial-rating` | — | `number` | `1500` | Default initial Elo rating for new skills |
| `--max-matches` | — | `number` | `20` | Total match pairings to simulate |
| `--db-path` | `--db` | `string` | `./benchmarks.db` | Telemetry database containing run history |

---

### `report`
Generate benchmark summary reports, markdown leaderboards, standalone SVG badges, or HTML report cards.

```bash
bun run src/cli/index.ts report [options]
```

#### Options & Flags

| Flag | Short Alias | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `--format` | `-f` | `string` | `console` | Report format: `console`, `markdown`, `html`, `json` |
| `--output` | `-o` | `string` | Inferred from format | Output file destination path |
| `--export-card` | `--card` | `string` | — | Export standalone card format: `svg` or `html` |
| `--card-output` | — | `string` | `report-card.<ext>` | Destination path for exported card |
| `--db-path` | `--db` | `string` | `./benchmarks.db` | Source telemetry SQLite database |
| `--control-skill` | — | `string` | `generic-agent` | Baseline skill ID used for delta comparisons |
| `--title` | — | `string` | `"Agent Skill Benchmark Dashboard"` | Dashboard display title |
| `--include-cost` | — | `boolean` | `true` | Include cost-efficiency analysis |
| `--include-trends` | — | `boolean` | `true` | Include historical trend metrics |

#### Examples

```bash
# Export Markdown Leaderboard
bun run src/cli/index.ts report -f markdown -o docs/LEADERBOARD.md --db data/benchmark-results.db

# Export Standalone HTML Dashboard
bun run src/cli/index.ts report -f html -o data/dashboard.html --db data/benchmark-results.db
```

---

### `sync`
Synchronize, download, parse, and register agent skills from the local catalog or remote repositories.

```bash
bun run src/cli/index.ts sync [options]
```

#### Options & Flags

| Flag | Short Alias | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `--catalog` | — | `string` | `./catalog` | Source catalog path (JSON or Markdown) |
| `--target-dir` | — | `string` | `./skills` | Directory where downloaded skills are stored |
| `--force` | — | `boolean` | `false` | Force redownload and re-indexing of existing skills |
| `--verify-only` | — | `boolean` | `false` | Validate skill manifests without downloading |

---

### `list`
Inspect available benchmark entities across the repository.

```bash
bun run src/cli/index.ts list [options]
```

#### Options & Flags

| Flag | Short Alias | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `--target` | — | `string` | `all` | Filter target: `all`, `scenarios`, `skills`, `models` |
| `--category` | `-c` | `string` | — | Filter scenarios or skills by category |

---

### `replay`
Replay recorded trajectory events in the terminal scrubber, export to Web replay HTML, or dump JSON event streams.

```bash
bun run src/cli/index.ts replay [options] [target-file]
```

#### Options & Flags

| Flag | Short Alias | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `--format` | `-f` | `string` | `tui` | Player format: `tui`, `html`, `json` |
| `--speed` | — | `number` | `1.0` | Playback speed multiplier (0.1x to 20x) |
| `--live` | — | `boolean` | `false` | Start playback automatically |
| `--output` | `-o` | `string` | `replay.html` | Destination path when exporting to HTML/JSON |
| `--web` | — | `boolean` | `false` | Shorthand for `--format html` |

---

### `fuzz`
Run adversarial fuzz mutations against benchmark scenarios to test agent boundary handling and safety constraints.

```bash
bun run src/cli/index.ts fuzz [options]
```

#### Options & Flags

| Flag | Short Alias | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `--scenario` | `-s` | `string[]` | `["git-worktrees"]` | Scenarios to mutate and test |
| `--strategy` | — | `string[]` | `["instruction_obfuscation", "tool_fault_injection"]` | Fuzz strategies |
| `--severity` | — | `string[]` | `["medium", "high"]` | Mutation severity levels |
| `--mutations` | — | `number` | `4` | Number of mutated variants per scenario |
| `--seed` | — | `number` | `42` | Pseudorandom seed for deterministic mutation |

---

## 3. Standardized Exit Codes

The CLI returns deterministic process exit codes for integration into CI/CD pipelines:

| Exit Code | Classification | Meaning |
| :--- | :--- | :--- |
| `0` | `SUCCESS` | Command completed successfully with all checks passing |
| `1` | `EXECUTION_FAILURE` | Benchmark trial failed or deterministic checks failed |
| `2` | `INVALID_ARGUMENTS` | Invalid command syntax, unrecognized flags, or missing options |
| `3` | `BUDGET_OR_TIMEOUT` | Spending ceiling exceeded or trial timed out |
| `4` | `SANDBOX_ERROR` | Docker container failure, permission error, or I/O failure |

---

## Next Steps

Explore the interactive terminal shell and live status controls:

- [Previous: Configuration](../getting-started/configuration.md)
- [Next: Interactive Shell & Terminal Controls](interactive-shell.md)


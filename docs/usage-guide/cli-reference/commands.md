# CLI Command Reference

[Configuration](../getting-started/configuration.md) | [Single trial](../running-benchmarks/single-trial.md)

Use the package entry point:

```bash
bun run cli -- <command> [options]
```

`bun run bin/skill-benchmarks <command> [options]` is equivalent. Do not invoke `src/cli/index.ts` directly.

## `run`

`run` and its alias `bench` execute one or more benchmark cells. A cell is the combination of a scenario, skill, model, and repetition. With no mode selection, it uses the deterministic fake provider.

```bash
bun run cli -- run \
  --mock \
  --scenario git-worktrees \
  --skill using-git-worktrees \
  --model claude-3-7-sonnet \
  --output-dir .benchmarks
```

| Option | Meaning |
| --- | --- |
| `-s`, `--scenario <ids>` | Scenario ID or comma-separated IDs |
| `-k`, `--skill <ids>` | Skill ID or comma-separated IDs |
| `-m`, `--model <ids>` | Model ID or comma-separated IDs |
| `-p`, `--provider <id>` | Explicit provider for the requested model |
| `-j`, `--concurrency <n>` | Maximum simultaneous cells |
| `-r`, `--repetitions <n>` | Repetitions per matrix cell |
| `--mock` | Explicit deterministic fake mode |
| `--live` | Explicit provider-backed mode; a provider key is required |
| `--output-dir <path>` | Runtime root; default `.benchmarks/` |
| `--db <path>` | SQLite index; default `<output-root>/db/benchmarks.sqlite` |
| `--dry-run` | Creates simulated execution evidence without live provider work |
| `--timeout <seconds>` | Wall-clock limit for a cell |
| `--max-turns <n>` | Maximum interaction turns |
| `--max-cost <usd>` | Cost limit for a cell |

`SKILL_BENCHMARKS_USE_MOCK=true` selects fake mode and `SKILL_BENCHMARKS_USE_MOCK=false` selects live mode. `SKILL_BENCHMARKS_OUTPUT_DIR` supplies the runtime root when `--output-dir` is absent. The only accepted mock environment values are `true` and `false`.

## `report`

`report` reads an existing SQLite database and prints or writes a summary. Supply `--db` for the database produced by `run`, and direct files to the existing output root's `exports/` directory.

```bash
bun run cli -- report \
  --db .benchmarks/db/benchmarks.sqlite \
  --format markdown \
  --output .benchmarks/exports/leaderboard.md
```

| Option | Meaning |
| --- | --- |
| `--db <path>` | SQLite database to read |
| `--format <console|json|markdown|html>` | Report rendering format |
| `--output <path>` | Destination for markdown, HTML, or JSON output |

## Supporting commands

The package also exposes `arena`, `tournament`, `sync`, `list`, `replay`, and `fuzz`. Their behavior and output contracts are not part of the fake-first benchmark workflow. Use the built-in command help for their currently implemented options:

```bash
bun run cli -- help <command>
```

## Runtime output

`run` creates its output under `.benchmarks/` by default. The runtime root contains `db/`, `runs/`, `sweeps/`, and `exports/`. Each run has `manifest.json` and `result.json`, and each sweep has `sweeps/<sweep-id>/checkpoint.json`. Runtime output is ignored by Git; checked-in `data/` files are demonstrations, not generated benchmark results.

## Result terminology

`COMPLETE` means the execution reached a terminal successful execution state. `PASS` means a benchmark pass with evaluation evidence. Fake and dry-run records are simulated and have zero synthetic provider cost; without evaluation evidence they are not benchmark passes.

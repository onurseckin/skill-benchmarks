# Run One Trajectory

[Previous: catalog](../getting-started/catalog-selection.md) | [Usage guide](../README.md) | [Next: matrix](matrix-sweeps.md)

## Run fake mode

```bash
bun run cli -- run \
  --mock \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o \
  --output-dir .benchmarks
```

Fake mode is deterministic and needs no credential. The tool workspace is confined below the generated run directory rather than the repository checkout.

`COMPLETE` means the cell reached a successful execution terminal. The record remains simulated, ineligible, and not evaluated. Do not infer model quality from it.

## Validate a selection with dry run

```bash
bun run cli -- run \
  --dry-run \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o \
  --output-dir .benchmarks-plan
```

Dry run still follows the run command's admitted matrix and persistence contract. Treat its output as simulated diagnostic evidence, not as a no-artifact command.

## Limit execution

```bash
bun run cli -- run \
  --mock \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o \
  --timeout 120 \
  --max-turns 10 \
  --max-cost 0.50 \
  --output-dir .benchmarks
```

`--timeout` is positive seconds with millisecond precision. `--max-turns` is a positive integer. `--max-cost` is a nonnegative finite USD limit.

## Inspect one run

```bash
find .benchmarks/runs -maxdepth 2 -type f
bun run cli -- report --db .benchmarks/db/benchmarks.sqlite
```

Use [replay](../interactive-features/tui-player.md) for `events.jsonl` and [reports](../reports/generating-reports.md) for database queries.

## Select live mode intentionally

```bash
GEMINI_API_KEY="replace-with-a-real-key" bun run cli -- run \
  --live \
  --provider google \
  --scenario git-worktrees \
  --skill tdd \
  --model gemini-2.0-flash-thinking-exp-01-21 \
  --output-dir .benchmarks
```

This is an opt-in provider request. See [configuration](../getting-started/configuration.md) before running it. Do not combine `--live` and `--mock`.

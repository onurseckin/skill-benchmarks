# Run a Matrix

[Previous: single run](single-trial.md) | [Usage guide](../README.md) | [Next: diagnostics](../interactive-features/arena-debates.md)

## Expand model and repetition selectors

```bash
bun run cli -- run \
  --mock \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o,claude-3-7-sonnet-20250219 \
  --repetitions 2 \
  --concurrency 2 \
  --output-dir .benchmarks
```

Every scenario, skill, model, thinking level, and repetition combination becomes a distinct cell. `--concurrency` and `--repetitions` are positive integers.

The command writes one run directory per cell and one sweep directory containing `plan.json`, `checkpoint.json`, and `outcome.json`. The checkpoint is persisted evidence; there is no public automatic-resume option.

## Vary thinking controls

```bash
bun run cli -- run \
  --dry-run \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o \
  --matrix-thinking low,medium,high \
  --thinking-budget 4096
```

`--thinking` accepts `none`, `low`, `medium`, `high`, or `max`. `--matrix-thinking` accepts a unique comma-separated list from the same set. `--thinking-budget` is a nonnegative integer. `--reasoning` accepts `low`, `medium`, or `high`.

## Export the stored cohort

```bash
bun run cli -- report \
  --db .benchmarks/db/benchmarks.sqlite \
  --format markdown \
  --output .benchmarks/exports/matrix-diagnostic.md
```

Fake matrix cells remain simulated, ineligible, and not evaluated. A report can summarize their diagnostic provenance but cannot make them ranked evidence.

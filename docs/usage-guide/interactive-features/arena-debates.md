# Arena and Tournament Diagnostics

[Previous: matrix](../running-benchmarks/matrix-sweeps.md) | [Usage guide](../README.md) | [Next: reports](../reports/generating-reports.md)

Arena and tournament commands expose comparison plans and candidate diagnostics. They never produce winners, ratings, standings, or rankings.

## Plan one arena pairing

```bash
bun run cli -- arena \
  --dry-run \
  --scenario git-worktrees \
  --skill tdd \
  --arena gpt-4o,claude-3-7-sonnet-20250219 \
  --output .benchmarks/exports/arena-plan.json
```

Arena requires exactly one scenario, one skill, and two distinct models. Dry run emits a planned, unranked pairing and performs no benchmark candidate execution.

## Run fake arena candidates

```bash
bun run cli -- arena \
  --mock \
  --scenario git-worktrees \
  --skill tdd \
  --arena gpt-4o,claude-3-7-sonnet-20250219 \
  --output-dir .benchmarks-arena \
  --output .benchmarks-arena/exports/arena.json
```

The result remains simulated and unranked. `--output` writes diagnostic JSON only.

## Plan a tournament

```bash
bun run cli -- tournament \
  --dry-run \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o,claude-3-7-sonnet-20250219 \
  --tournament-mode round-robin
```

Tournament requires one or more scenarios, exactly one skill, and at least two models. `--tournament-mode` accepts `round-robin` or `swiss`. `--rounds` is a positive integer bounded by the derived schedule.

Swiss mode materializes round one and records later rounds as unplanned because later pairings depend on unavailable prior results.

## Live comparison

Live arena and tournament comparison is unavailable. Selecting `--live` returns nonzero and starts no candidate provider execution because durable candidate, match, and judge evidence does not share one verified identity yet.

# CLI Interaction

[Command reference](commands.md) | [Single benchmark](../running-benchmarks/single-trial.md)

The current package exposes a command-oriented CLI. It does not provide an interactive scenario selector or an in-place benchmark control shell.

## Discover commands

```bash
bun run cli -- --help
bun run cli -- help run
bun run cli -- run --help
```

The run help lists the fake/live mode controls and the output root:

```text
--mock
--live
--output-dir <path>
```

## Follow execution in the terminal

Use the benchmark command directly. It emits a start banner, one terminal status per cell, and a completion summary.

```bash
bun run cli -- run \
  --mock \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o \
  --output-dir .benchmarks
```

`COMPLETE` signals that a cell's execution reached a successful terminal state. `PASS` requires evaluation evidence. For the recorded run identity, status, and aggregate values, inspect `.benchmarks/runs/<run-id>/manifest.json` and `result.json`.

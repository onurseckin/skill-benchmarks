# Command Discovery and Piped Output

[Usage guide](../README.md) | [CLI reference](commands.md) | [Next: reports](../reports/generating-reports.md)

The package exposes a command-oriented CLI. It has no interactive scenario selector or benchmark control shell.

## Discover grammar

```bash
bun run cli -- --help
bun run cli -- help run
bun run cli -- run --help
```

Use command help as the executable grammar. The long-form [CLI reference](commands.md) adds constraints and examples.

## Read execution output

```bash
bun run cli -- run \
  --mock \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o \
  --output-dir .benchmarks
```

The run command prints one terminal status per cell and one sweep summary. `COMPLETE` describes execution lifecycle only. Inspect `manifest.json`, `result.json`, and the database for persisted provenance.

## Pipe machine-readable output

```bash
bun run cli -- report \
  --db .benchmarks/db/benchmarks.sqlite \
  --format json > .benchmarks/exports/report.json

bun run cli -- replay \
  --run-id <run-id> \
  --db .benchmarks/db/benchmarks.sqlite \
  --output-dir .benchmarks \
  --format json > .benchmarks/exports/replay.json
```

JSON stdout is one document and contains no terminal escape sequences. Errors are written to stderr and return nonzero. TUI replay is rejected when stdout is not an interactive terminal.

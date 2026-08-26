# Replay Persisted Events

[Previous: reports](../reports/generating-reports.md) | [Usage guide](../README.md) | [CLI reference](../cli-reference/commands.md#replay)

Replay reads validated persisted execution events. It does not rerun a model or mutate the evidence database.

## On this page

- [Canonical replay](#canonical-replay)
- [Direct replay](#direct-replay)
- [Formats](#formats)
- [Output safety](#output-safety)

## Canonical replay

Find the run directory name below the runtime root, then provide the full canonical source triple:

```bash
bun run cli -- replay \
  --run-id <run-id> \
  --db .benchmarks/db/benchmarks.sqlite \
  --output-dir .benchmarks \
  --format json
```

Canonical replay reconciles the database record with `events.jsonl`, `manifest.json`, and `result.json` for that run.

## Direct replay

```bash
bun run cli -- replay .benchmarks/runs/<run-id>/events.jsonl --format json
```

You may instead use `--target <path>`. Direct sources must end in `.jsonl` or `.json`. A direct source validates its own event or replay-session content but does not establish canonical database identity.

## Formats

### TUI

```bash
bun run cli -- replay .benchmarks/runs/<run-id>/events.jsonl --format tui --speed 1
```

TUI is the default format and requires an interactive terminal. `--speed` is TUI-only and accepts values from `0.1` through `20`. TUI rejects `--output`.

### JSON

```bash
bun run cli -- replay \
  .benchmarks/runs/<run-id>/events.jsonl \
  --format json \
  --output .benchmarks/exports/replay.json
```

Without `--output`, JSON writes one document to stdout. With `--output`, stdout is empty.

### HTML

```bash
bun run cli -- replay \
  .benchmarks/runs/<run-id>/events.jsonl \
  --format html \
  --output .benchmarks/exports/replay.html
```

HTML requires `--output`. Non-TUI formats reject `--speed`.

## Output safety

Replay rejects an output path that collides with its input. For canonical replay, protected inputs include the database, events, manifest, and result files. Invalid, missing, mismatched, or symlinked canonical evidence exits nonzero without publishing the requested export.

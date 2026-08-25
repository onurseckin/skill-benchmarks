# Running a Single Benchmark

[Configuration](../getting-started/configuration.md) | [CLI reference](../cli-reference/commands.md) | [Matrix sweeps](matrix-sweeps.md)

A benchmark cell combines a scenario, a skill, and a model. The `run` command accepts one value for each, or lists that expand into a matrix. The command is fake-first: without a live selection it runs the deterministic fake provider and does not contact a provider API.

## Run the local deterministic trajectory

```bash
bun run cli -- run \
  --mock \
  --scenario git-worktrees \
  --skill using-git-worktrees \
  --model claude-3-7-sonnet \
  --output-dir .benchmarks
```

The CLI reports `COMPLETE` when the execution finishes. It reports `PASS` only when benchmark evaluation evidence exists and all required execution conditions succeed. A fake run normally completes with zero provider cost and an unevaluated benchmark result; it must not be read as a model-quality score.

## Select a live provider intentionally

Live execution must be selected with `--live` or `SKILL_BENCHMARKS_USE_MOCK=false`. The selected provider credential is required before provider construction.

```bash
GEMINI_API_KEY="replace-with-a-real-key" bun run cli -- run \
  --live \
  --provider google \
  --scenario git-worktrees \
  --skill using-git-worktrees \
  --model gemini-2-0-flash \
  --output-dir .benchmarks
```

Do not combine `--live` with `--mock`.

## Inspect the run bundle

The default output root is `.benchmarks/`. Every cell receives a distinct run directory:

```text
.benchmarks/runs/<run-id>/
├── manifest.json
├── result.json
└── workspace/
```

`manifest.json` identifies the effective provider, model, scenario, execution mode, and simulated status before provider work begins. `result.json` records the terminal status, termination reason, and available aggregate runtime values. The fake workspace is below the run directory; tool calls do not fall back to the repository checkout.

The SQLite index is `.benchmarks/db/benchmarks.sqlite`, and the current sweep's resumable checkpoint is `.benchmarks/sweeps/<sweep-id>/checkpoint.json`. For a custom output root, replace `.benchmarks` in those paths with the value passed to `--output-dir`.

## Export a report

After a run, use the generated SQLite index and choose an explicit path below `exports/`:

```bash
bun run cli -- report \
  --db .benchmarks/db/benchmarks.sqlite \
  --format markdown \
  --output .benchmarks/exports/single-trial.md
```

The report summarizes stored run records. It does not turn an unevaluated fake execution into a benchmark pass.

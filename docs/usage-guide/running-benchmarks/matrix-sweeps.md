# Matrix Sweeps

[Single benchmark](single-trial.md) | [Configuration](../getting-started/configuration.md) | [CLI reference](../cli-reference/commands.md)

The `run` command creates a matrix when more than one scenario, skill, model, thinking level, or repetition is supplied. It executes fake mode by default, so the following command is safe to run without provider credentials.

## Run a local fake matrix

```bash
bun run cli -- run \
  --mock \
  --scenario git-worktrees \
  --skill using-git-worktrees \
  --model claude-3-7-sonnet,gpt-4o \
  --repetitions 2 \
  --concurrency 2 \
  --output-dir .benchmarks
```

Each combination becomes a separate cell and receives a run directory under `.benchmarks/runs/`. The displayed `COMPLETE` status means its execution completed; it is not a benchmark `PASS` unless evaluation evidence exists.

## Output and checkpoints

The run command writes its SQLite index to `.benchmarks/db/benchmarks.sqlite` and its current sweep checkpoint to `.benchmarks/sweeps/<sweep-id>/checkpoint.json`. Use `--output-dir` or `SKILL_BENCHMARKS_OUTPUT_DIR` to place all runtime artifacts elsewhere.

```bash
bun run cli -- report \
  --db .benchmarks/db/benchmarks.sqlite \
  --format markdown \
  --output .benchmarks/exports/matrix-summary.md
```

The checkpoint is persisted for run evidence. Automatic command-line resume is not currently exposed; retain the output root when you need to inspect a completed or interrupted sweep.

## Live matrices

Select live mode only when you intend provider requests:

```bash
OPENAI_API_KEY="replace-with-a-real-key" bun run cli -- run \
  --live \
  --provider openai \
  --scenario git-worktrees \
  --skill using-git-worktrees \
  --model gpt-4o \
  --repetitions 2 \
  --output-dir .benchmarks
```

Live credentials are validated before the first provider request. See [configuration](../getting-started/configuration.md) for the supported environment variables.

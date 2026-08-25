# Configuration

[Table of Contents](../README.md) | [CLI reference](../cli-reference/commands.md) | [Single trial](../running-benchmarks/single-trial.md)

The benchmark CLI reads its configuration from the process environment and command-line flags. It does not load a `.env` file.

## Execution mode

Fake mode is the default. It performs no provider network request and is intended for deterministic local verification.

| Selection | Effective mode |
| --- | --- |
| No mode flag or environment value | Fake |
| `--mock` | Fake |
| `SKILL_BENCHMARKS_USE_MOCK=true` | Fake |
| `--live` | Live |
| `SKILL_BENCHMARKS_USE_MOCK=false` | Live |

`SKILL_BENCHMARKS_USE_MOCK` accepts exact lowercase `true` and `false`. An absent or empty value leaves the mode unselected. Every other nonempty value is invalid. `--mock` and `--live` are mutually exclusive and override a valid environment selection. Live mode validates the selected provider's key before attempting a request.

| Provider | Required live credential |
| --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |

Example fake run:

```bash
bun run cli -- run \
  --mock \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o \
  --output-dir .benchmarks
```

Example live run:

```bash
OPENAI_API_KEY="replace-with-a-real-key" bun run cli -- run \
  --live \
  --provider openai \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o \
  --output-dir .benchmarks
```

## Output root and database

The runtime root is selected in this order:

1. `--output-dir <path>`
2. `SKILL_BENCHMARKS_OUTPUT_DIR=<path>`
3. `.benchmarks/` under the current directory

The benchmark command writes its SQLite index to `<output-root>/db/benchmarks.sqlite` unless `--db <path>` is supplied. Keep a custom database under the output root to retain one portable run bundle.

```bash
SKILL_BENCHMARKS_OUTPUT_DIR=.benchmarks-local bun run cli -- run \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o
```

## Artifact layout

Each benchmark invocation creates the standard top-level directories below its output root:

```text
<output-root>/
├── db/benchmarks.sqlite
├── runs/<run-id>/
│   ├── manifest.json
│   ├── result.json
│   └── workspace/
└── sweeps/<sweep-id>/checkpoint.json
```

`manifest.json` records the planned run identity and execution provenance. `result.json` records its terminal status and the available runtime totals. The workspace is created only beneath the run directory and is not the repository checkout. Future evidence files use these same run directories when their producers are enabled.

`<output-root>/exports/` is the reserved destination for files requested with `report --output`; it is not per-run evidence and may be empty until a report is written.

Generated runtime output is ignored by Git. The checked-in `data/` directory contains demonstrations and must not be treated as CLI output.

## Report exports

Reports read an explicit SQLite database and write only to the path supplied with `--output`. Use the output root's reserved `exports/` destination for those files.

```bash
bun run cli -- report \
  --db .benchmarks/db/benchmarks.sqlite \
  --format json \
  --output .benchmarks/exports/leaderboard.json
```

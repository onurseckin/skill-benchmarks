# Configuration

[Previous: installation](installation.md) | [Usage guide](../README.md) | [Next: catalog](catalog-selection.md)

The CLI reads process environment variables and command options. It does not load a `.env` file.

## On this page

- [Execution mode](#execution-mode)
- [Live credentials](#live-credentials)
- [Output and database](#output-and-database)
- [Runtime bundle](#runtime-bundle)

## Execution mode

| Selection                           | Effective mode |
| ----------------------------------- | -------------- |
| No mode option or environment value | Fake           |
| `--mock`                            | Fake           |
| `SKILL_BENCHMARKS_USE_MOCK=true`    | Fake           |
| `--live`                            | Live           |
| `SKILL_BENCHMARKS_USE_MOCK=false`   | Live           |

`SKILL_BENCHMARKS_USE_MOCK` accepts only exact lowercase `true` or `false`. An absent or empty value makes no selection; every other nonempty value is invalid. `--mock` and `--live` override a valid environment selection and cannot be combined.

Fake mode makes no provider request. Fake and dry-run records remain simulated, ineligible, and not evaluated.

## Live credentials

Use live mode only when you intend provider traffic. A normal live run requires a nonblank credential for the selected model provider before the first request.

| Provider  | Environment variable                 |
| --------- | ------------------------------------ |
| Anthropic | `ANTHROPIC_API_KEY`                  |
| OpenAI    | `OPENAI_API_KEY`                     |
| Google    | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |

```bash
OPENAI_API_KEY="replace-with-a-real-key" bun run cli -- run \
  --live \
  --provider openai \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o \
  --output-dir .benchmarks
```

The public grammar also recognizes provider IDs `ollama` and `custom`, but this guide does not present them as supported live-provider workflows. The selected provider must match the canonical provider of every selected model.

Live arena and tournament comparison is unavailable. Those commands fail closed without candidate provider execution because durable match and judge evidence is absent.

## Output and database

The runtime root is selected in this order:

1. `--output-dir <path>`
2. `SKILL_BENCHMARKS_OUTPUT_DIR=<path>`
3. `.benchmarks/` below the current working directory

The run database defaults to `<output-root>/db/benchmarks.sqlite`. `run --db <path>` selects another SQLite path. Keep a custom database below the output root when you want one portable bundle.

```bash
SKILL_BENCHMARKS_OUTPUT_DIR=.benchmarks-local bun run cli -- run \
  --mock \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o
```

## Runtime bundle

```text
<output-root>/
├── db/benchmarks.sqlite
├── exports/
├── runs/<run-id>/
│   ├── events.jsonl
│   ├── manifest.json
│   ├── raw.log
│   └── result.json
└── sweeps/<sweep-id>/
    ├── checkpoint.json
    ├── outcome.json
    └── plan.json
```

`events.jsonl` is the persisted replay source. `manifest.json` records planned identity and provenance. `result.json` records terminal lifecycle and available aggregate values. `raw.log` is optional. Workspaces are confined below their run directory while present and may be removed after execution.

The sweep files preserve the admitted plan and terminal reconciliation. They are not a public automatic-resume interface.

`exports/` is reserved for report and replay files requested by the operator. Exports are derived presentation, not run evidence. No `evaluation.json` producer is available in the current public workflow.

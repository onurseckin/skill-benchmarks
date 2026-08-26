# Frontier AI Agent Skill Benchmark Suite

`skill-benchmarks` is a command-line harness for running skill-and-scenario executions and inspecting their persisted evidence. Fake execution is the default, so the normal workflow needs no provider credentials and makes no provider request.

## Quickstart

```bash
bun install --frozen-lockfile
bun run cli -- run \
  --mock \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o \
  --output-dir .benchmarks
```

The public executable entry point in this checkout is `bun run cli --`. The command above writes a deterministic fake trajectory in a disposable workspace below `.benchmarks/`. `COMPLETE` means execution reached its terminal state. Fake output remains simulated, ineligible, and not evaluated; it is operational evidence, not a model-quality result.

## Common commands

| Goal                                 | Command                                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Show command help                    | `bun run cli -- --help`                                                                                                |
| List checked-in scenarios and skills | `bun run cli -- list all`                                                                                              |
| Check a run selection                | `bun run cli -- run --dry-run --scenario git-worktrees --skill tdd --model gpt-4o`                                     |
| Run one fake trajectory              | `bun run cli -- run --mock --scenario git-worktrees --skill tdd --model gpt-4o`                                        |
| Export a diagnostic report           | `bun run cli -- report --db .benchmarks/db/benchmarks.sqlite --format json`                                            |
| Replay one canonical run as JSON     | `bun run cli -- replay --run-id <run-id> --db .benchmarks/db/benchmarks.sqlite --output-dir .benchmarks --format json` |
| Run the maintained delivery gate     | `bun run test`                                                                                                         |

The public commands are `run`, `arena`, `tournament`, `report`, `list`, `replay`, `help`, and `version`. See the [CLI reference](docs/usage-guide/cli-reference/commands.md) for every option and constraint.

## Fake and live execution

No mode option selects fake execution. `--mock` makes that choice explicit. `SKILL_BENCHMARKS_USE_MOCK=true` also selects fake mode.

Use `--live` only when you intend a provider request. A normal `run --live` validates a nonblank credential for the selected model provider before the request begins:

```bash
OPENAI_API_KEY="replace-with-a-real-key" bun run cli -- run \
  --live \
  --provider openai \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o \
  --output-dir .benchmarks
```

The repository verification gates remove provider keys and never run live provider checks. Arena and tournament execution remains diagnostic only: dry runs are planned and unranked, fake runs are simulated and unranked, and live comparison is unavailable because durable match and judge evidence is not implemented.

See [configuration](docs/usage-guide/getting-started/configuration.md) for exact environment precedence and credential names.

## Runtime bundle

The default output root is `.benchmarks/`. Select another root with `--output-dir` or `SKILL_BENCHMARKS_OUTPUT_DIR`.

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

`raw.log` is optional. Execution workspaces are confined below their run directory while present and may be cleaned after execution. `exports/` holds requested derived report or replay files; those exports are not run evidence. Checked-in files under `data/` are demonstrations, not CLI-generated results.

## Reports and replay

Reports require an existing SQLite database and never create a missing one:

```bash
bun run cli -- report \
  --db .benchmarks/db/benchmarks.sqlite \
  --format markdown \
  --output .benchmarks/exports/diagnostic-report.md
```

Fake-only reports show diagnostic provenance and no eligible benchmark evidence. They do not convert simulated executions into scores or rankings.

Replay a canonical run with its database and output root, or read a direct `.jsonl` or replay `.json` file:

```bash
bun run cli -- replay \
  --run-id <run-id> \
  --db .benchmarks/db/benchmarks.sqlite \
  --output-dir .benchmarks \
  --format json
```

See [reports](docs/usage-guide/reports/generating-reports.md) and [replay](docs/usage-guide/interactive-features/tui-player.md) for formats, filters, and output rules.

## Documentation

- [Consumer usage guide](docs/usage-guide/README.md)
- [Installation](docs/usage-guide/getting-started/installation.md)
- [Catalog and selection](docs/usage-guide/getting-started/catalog-selection.md)
- [Single run](docs/usage-guide/running-benchmarks/single-trial.md)
- [Arena and tournament diagnostics](docs/usage-guide/interactive-features/arena-debates.md)
- [Maintainer verification](docs/usage-guide/maintenance/verification.md)
- [Architecture documentation](docs/architecture/README.md)

## Maintainer verification

`bun run test` performs root typechecking, the maintained static boundary, and all no-key operator delivery cases, including local and Docker testbed lifecycles.

```bash
bun run test
```

Focused commands and prerequisites are documented in [maintainer verification](docs/usage-guide/maintenance/verification.md). CI invokes the same public `bun run test` command, then publishes a separately reconciled simulated diagnostic bundle.

## License

MIT © [Onur Seckin Senoglu](https://github.com/onurseckin)

# Generate Reports

[Previous: diagnostics](../interactive-features/arena-debates.md) | [Usage guide](../README.md) | [Next: replay](../interactive-features/tui-player.md)

Reports query an existing SQLite evidence database. They do not execute scenarios, mutate run records, or create a missing database.

## On this page

- [Console summary](#console-summary)
- [JSON, Markdown, and HTML](#json-markdown-and-html)
- [Filter a cohort](#filter-a-cohort)
- [Cost and report cards](#cost-and-report-cards)
- [Interpret fake evidence](#interpret-fake-evidence)

## Console summary

```bash
bun run cli -- report --db .benchmarks/db/benchmarks.sqlite
```

Console is the default format and rejects `--output`.

## JSON, Markdown, and HTML

Write one JSON document to stdout:

```bash
bun run cli -- report \
  --db .benchmarks/db/benchmarks.sqlite \
  --format json
```

Write JSON to a file and leave stdout empty:

```bash
bun run cli -- report \
  --db .benchmarks/db/benchmarks.sqlite \
  --format json \
  --output .benchmarks/exports/report.json
```

Markdown and HTML require an output file:

```bash
bun run cli -- report \
  --db .benchmarks/db/benchmarks.sqlite \
  --format markdown \
  --output .benchmarks/exports/report.md

bun run cli -- report \
  --db .benchmarks/db/benchmarks.sqlite \
  --format html \
  --title "Diagnostic Evidence" \
  --output .benchmarks/exports/report.html
```

Report publication is atomic and rejects output paths that collide with the source database.

## Filter a cohort

```bash
bun run cli -- report \
  --db .benchmarks/db/benchmarks.sqlite \
  --format json \
  --scenario git-worktrees \
  --category coding \
  --skill tdd \
  --model gpt-4o \
  --provider openai \
  --status completed \
  --execution-mode fake \
  --simulated true \
  --authority diagnostic \
  --cohort validation \
  --eligibility ineligible \
  --evaluation-status not_evaluated \
  --evidence-status unavailable
```

Array filters accept unique comma-separated or repeated values. The exact enum choices are in the [`report` reference](../cli-reference/commands.md#report).

`--from-date` and `--to-date` are inclusive parseable timestamps. The start must not be later than the end.

## Cost and report cards

`--include-cost` includes only verified eligible cost facts. Simulated zero-cost diagnostics do not become actual cost evidence.

`--export-card svg|html` requires `--card-output`, one exact `--skill` filter, and exactly one eligible skill cohort. A fake-only database does not satisfy those conditions and the command exits nonzero.

## Interpret fake evidence

A fake-only report can truthfully show matched diagnostic counts, simulated provenance, lifecycle status, and `NO ELIGIBLE BENCHMARK EVIDENCE`. Its leaderboard arrays remain empty. It does not create scores or rankings from simulated records.

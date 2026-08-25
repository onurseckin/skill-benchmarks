# Arena and Tournament Diagnostics

Arena and tournament commands expose admitted comparison plans and unranked candidate diagnostics. They do not produce winners, standings, ratings, confidence claims, or benchmark scores.

Use `--dry-run` to validate selectors and inspect deterministic pairings without creating a database or running a provider:

```bash
bun run src/cli/index.ts arena --dry-run --scenario fullstack-refactor --skill tdd --arena gpt-4o,claude-3-7-sonnet-20250219
bun run src/cli/index.ts tournament --dry-run --scenario fullstack-refactor --skill tdd --model gpt-4o,claude-3-7-sonnet-20250219
```

Use `--mock` to run both candidates through the shared fake benchmark sweep. The result remains `SIMULATED / UNRANKED` and records candidate provenance only:

```bash
bun run src/cli/index.ts arena --mock --scenario fullstack-refactor --skill tdd --arena gpt-4o,claude-3-7-sonnet-20250219 --output-dir ./artifacts --output ./arena.json
```

Live comparison is unavailable until durable candidate, match, and judge evidence share one verified identity. The command fails closed without starting provider work. A planned pairing or simulated candidate diagnostic is never rank-eligible evidence.

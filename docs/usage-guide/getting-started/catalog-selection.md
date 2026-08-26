# Catalog and Selection

[Previous: configuration](configuration.md) | [Usage guide](../README.md) | [Next: single run](../running-benchmarks/single-trial.md)

## List checked-in inputs

```bash
bun run cli -- list scenarios
bun run cli -- list skills
bun run cli -- list all
```

The target is optional and defaults to `all`. Valid targets are `scenarios`, `skills`, and `all`. `list` has no filter, model-list, or machine-format option.

## Select one run cell

A run cell combines one scenario, one skill, and one model:

```bash
bun run cli -- run \
  --dry-run \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o \
  --output-dir .benchmarks-plan
```

`--skill` is required. If no scenario is supplied, `git-worktrees` is selected. If no model is supplied, the current CLI default is `claude-3-7-sonnet-20250219`.

Scenario IDs may also be positional:

```bash
bun run cli -- run git-worktrees --dry-run --skill tdd --model gpt-4o
```

Use either `--category <name>` without explicit scenarios to select matching checked-in scenarios, or combine it with explicit scenarios only when every selected scenario has that category.

## Select a matrix

Comma-separated values and repeated array options expand selectors. Every normalized value must remain unique.

```bash
bun run cli -- run \
  --dry-run \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o,claude-3-7-sonnet-20250219 \
  --repetitions 2
```

Scalar and boolean options may appear only once. Unknown IDs, duplicate normalized values, incompatible categories, or malformed values exit nonzero before cell execution.

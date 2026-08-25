# Installation

[Usage guide](../README.md) | [Configuration](configuration.md)

## Prerequisite

Install a current [Bun](https://bun.sh) runtime. The documented fake-first workflow does not require Docker or provider credentials.

## Install dependencies

```bash
git clone https://github.com/onurseckin/skill-benchmarks.git
cd skill-benchmarks
bun install
```

## Verify the checkout

```bash
bun run typecheck
bun run src/scripts/quality-gate.ts
bun run cli -- list --target all
```

## Run the first local benchmark

```bash
bun run cli -- run \
  --mock \
  --scenario git-worktrees \
  --skill using-git-worktrees \
  --model claude-3-7-sonnet \
  --output-dir .benchmarks
```

This command uses the deterministic fake provider and performs no provider request. It produces a `COMPLETE` execution record. See [single benchmark](../running-benchmarks/single-trial.md) for the artifact paths and [configuration](configuration.md) before selecting live mode.

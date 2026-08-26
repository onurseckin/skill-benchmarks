# Installation and First Run

[Usage guide](../README.md) | [Next: configuration](configuration.md)

## Prerequisite

Install Bun. Docker and provider credentials are not required for the fake-first consumer workflow.

## Install the checkout

```bash
git clone https://github.com/onurseckin/skill-benchmarks.git
cd skill-benchmarks
bun install --frozen-lockfile
```

## Inspect the catalog

```bash
bun run cli -- list all
```

`list` shows the checked-in scenarios and skills. It does not list models or emit JSON.

## Run the deterministic trajectory

```bash
bun run cli -- run \
  --mock \
  --scenario git-worktrees \
  --skill tdd \
  --model gpt-4o \
  --output-dir .benchmarks
```

The public checkout entry point is `bun run cli --`. This run removes the need for provider credentials, makes no provider request, and writes only beneath `.benchmarks/`. `COMPLETE` means the execution ended successfully; the fake record remains simulated, ineligible, and not evaluated.

## Inspect the generated paths

```bash
find .benchmarks/runs -maxdepth 2 -type f
find .benchmarks/sweeps -maxdepth 2 -type f
```

Continue with [configuration](configuration.md), then [run a single trajectory](../running-benchmarks/single-trial.md).

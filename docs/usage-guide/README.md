# Usage Guide

[Repository README](../../README.md) | [CLI reference](cli-reference/commands.md)

This guide is for people running the repository. It covers commands, inputs, outputs, and verification. Implementation internals belong in the separate [architecture documentation](../architecture/README.md).

The normal workflow is fake-first and no-key. Fake and dry-run records are simulated, ineligible, and not evaluated. Arena and tournament output is always unranked.

## Start here

1. [Install and run the first trajectory](getting-started/installation.md)
2. [Configure execution and output](getting-started/configuration.md)
3. [Select checked-in scenarios and skills](getting-started/catalog-selection.md)

## Run commands

- [Run one trajectory](running-benchmarks/single-trial.md)
- [Run a matrix](running-benchmarks/matrix-sweeps.md)
- [Plan or run arena and tournament diagnostics](interactive-features/arena-debates.md)

## Inspect output

- [Generate reports](reports/generating-reports.md)
- [Replay persisted events](interactive-features/tui-player.md)
- [Discover commands and read piped output](cli-reference/interactive-shell.md)
- [Look up every public command and option](cli-reference/commands.md)

## Maintain delivery

- [Run repository and CI verification](maintenance/verification.md)
- [Build and start the optional testbed](maintenance/testbed-delivery.md)

## Unavailable public workflows

- [Custom scenario authoring](custom-scenarios/authoring-scenarios.md) has no public CLI workflow.
- [Web streaming](interactive-features/web-streaming.md) has no public server, stream, or tunnel command.

The CLI also has no public model-list, sync, fuzz, or automatic checkpoint-resume command.

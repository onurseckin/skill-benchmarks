# Usage Guide

The documented benchmark workflow is deterministic and fake-first. It runs without provider credentials, keeps tool work inside a generated workspace, and records execution provenance under the selected output root.

## Start here

- [Installation](getting-started/installation.md) explains the local Bun setup.
- [Configuration](getting-started/configuration.md) defines fake/live selection, credentials, and runtime output.
- [CLI command reference](cli-reference/commands.md) lists the supported benchmark and report commands.

## Run and inspect benchmarks

- [Single benchmark](running-benchmarks/single-trial.md) runs and inspects one fake trajectory.
- [Matrix sweeps](running-benchmarks/matrix-sweeps.md) runs a local matrix and exports its stored records.
- [CLI interaction](cli-reference/interactive-shell.md) shows command discovery and terminal execution output.

The guide intentionally does not describe arena rankings, live web streaming, or synthetic judge verdicts as benchmark evidence. A fake `COMPLETE` run is an execution result, not a benchmark `PASS`.

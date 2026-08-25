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

## CI diagnostic

Continuous integration runs one no-key simulated trajectory for `git-worktrees`, `tdd`, and `gpt-4o` through the installed executable. The uploaded `simulated-diagnostic-<sha>` bundle contains the operator log, canonical run and sweep evidence, SQLite index, and diagnostic JSON report.

The package verifier reconciles command identity, isolation, event order, terminal evidence, persistence, provenance, and the report empty state before upload. This diagnostic proves operational health only. It produces no benchmark ranking or regression decision. The exact temporary-root reproduction command is in the root [local verification section](../../README.md#local-verification).

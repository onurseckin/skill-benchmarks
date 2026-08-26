# Matrix Sweeps

[Book index](../README.md) | [Part index](README.md) | [Next: runner and tools](runner-and-tools.md)

**Status:** implemented and public for admitted execution.

The sweep engine validates a matrix, derives deterministic cells and plan identity, acquires an output-root lease, opens the evidence database, persists checkpoints, applies concurrency accounting, and records terminal outcomes. Each cell owns one run identity and emits either a completed or failed terminal result.

## Source anchors

[`src/sweep/sweep-engine.ts`](../../../src/sweep/sweep-engine.ts), [`src/sweep/matrix-cell-planner.ts`](../../../src/sweep/matrix-cell-planner.ts), [`src/sweep/checkpoint.ts`](../../../src/sweep/checkpoint.ts), and [`src/sweep/terminal-cell-persistence.ts`](../../../src/sweep/terminal-cell-persistence.ts).

## Limitations

Concurrency is an implementation setting, not a claimed performance theorem. A dry run remains simulated diagnostic evidence.

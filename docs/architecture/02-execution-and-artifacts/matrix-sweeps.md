# Matrix Sweeps

[Book index](../README.md) | [Part index](README.md) | [Next: runner and tools](runner-and-tools.md)

**Status:** implemented and public for admitted execution.

The sweep engine validates a matrix, derives deterministic cells and plan identity, acquires an output-root lease, opens the evidence database, persists checkpoints, applies concurrency accounting, and records terminal outcomes. A terminalized cell record can be `completed`, `failed`, `aborted`, or `skipped`; the immutable sweep outcome also represents planned cells without a durable record as `unstarted`. Sweep status is independently `completed`, `failed`, or `aborted` after worker-pool and reconciliation outcomes are known.

## Source anchors

[`src/sweep/sweep-engine.ts`](../../../src/sweep/sweep-engine.ts), [`src/sweep/matrix-cell-planner.ts`](../../../src/sweep/matrix-cell-planner.ts), [`src/sweep/checkpoint.ts`](../../../src/sweep/checkpoint.ts), [`src/sweep/terminal-cell-persistence.ts`](../../../src/sweep/terminal-cell-persistence.ts), [`src/sweep/aborted-cell-terminalization.ts`](../../../src/sweep/aborted-cell-terminalization.ts), and [`src/sweep/sweep-outcome.ts`](../../../src/sweep/sweep-outcome.ts).

## Limitations

Concurrency is an implementation setting, not a claimed performance theorem. A dry run remains simulated diagnostic evidence.

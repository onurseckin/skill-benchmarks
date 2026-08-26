# Container Pool

[Book index](../README.md) | [Part index](README.md) | [Next: telemetry](telemetry.md)

**Status:** implemented, internal and optional per sweep.

`ContainerPoolManager` bounds active instances, queues acquisition, creates a Docker volume and container for a requested run, releases instances through teardown, and rejects new work after drain begins. Cell execution supplies a container only when its sweep configuration has a pool.

## Source anchors

[`src/infrastructure/container/pool.ts`](../../../src/infrastructure/container/pool.ts), [`src/infrastructure/container/instance.ts`](../../../src/infrastructure/container/instance.ts), [`src/infrastructure/container/state-machine.ts`](../../../src/infrastructure/container/state-machine.ts), and [`src/sweep/cell-execution.ts`](../../../src/sweep/cell-execution.ts).

## Limitations

The code creates containers on demand; it does not document a pre-warmed reusable pool. Drain-during-creation hardening remains outside current guarantees.

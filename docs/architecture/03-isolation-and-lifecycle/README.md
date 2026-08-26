# Part 3: Isolation and Lifecycle

[Book index](../README.md) | [Previous: execution](../02-execution-and-artifacts/README.md) | [Next: providers](../04-provider-boundary/README.md)

**Status:** implemented, internal.

## Chapters

- [Container pool](container-pool.md)
- [Telemetry](telemetry.md)

## Source anchors

[`src/infrastructure/container/pool.ts`](../../../src/infrastructure/container/pool.ts) and [`src/infrastructure/telemetry/event-scribe.ts`](../../../src/infrastructure/telemetry/event-scribe.ts).

## Limitations

Container lifecycle details are not a guarantee of pre-warming, full drain safety, or a public sandbox command.

# Chaos

[Book index](../README.md) | [Part index](README.md) | [Previous: arena and tournament](arena-and-tournament.md) | [Next: streaming and tunnels](streaming-and-tunnels.md)

**Status:** implemented diagnostic subsystem, not a public CLI workflow.

`ChaosEngine` validates schedules and coordinates a fault injector against an explicit container context. Its report records schedule, observation, and lifecycle facts.

## Source anchors

[`src/chaos/chaos-engine.ts`](../../../src/chaos/chaos-engine.ts), [`src/chaos/fault-injector.ts`](../../../src/chaos/fault-injector.ts), and [`src/chaos/types.ts`](../../../src/chaos/types.ts).

## Limitations

A configured fault or observed recovery does not establish resilience, benchmark pass, rank, or regression behavior.

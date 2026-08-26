# Telemetry

[Book index](../README.md) | [Part index](README.md) | [Previous: container pool](container-pool.md) | [Next part: providers](../04-provider-boundary/README.md)

**Status:** Implemented but not public

Persisted event telemetry is implemented as an internal surface.

The runner emits run, turn, and tool events through `EventScribe`. Artifact readers load the canonical event stream for replay. Container and resource profiling modules exist for internal use.

## Source anchors

[`src/infrastructure/telemetry/event-scribe.ts`](../../../src/infrastructure/telemetry/event-scribe.ts), [`src/infrastructure/telemetry/event-artifact-writer.ts`](../../../src/infrastructure/telemetry/event-artifact-writer.ts), [`src/infrastructure/telemetry/resource-profiler.ts`](../../../src/infrastructure/telemetry/resource-profiler.ts), and [`src/replay/event-session-loader.ts`](../../../src/replay/event-session-loader.ts).

## Limitations

The public CLI has no live telemetry-stream command. Recorded values do not establish model quality or sub-millisecond observability claims.

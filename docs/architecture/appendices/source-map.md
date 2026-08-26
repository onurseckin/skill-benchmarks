# Source Map

[Book index](../README.md) | [Appendix index](README.md) | [Limitations](current-limitations.md)

**Status:** Implemented but not public

This page is the current ownership map for maintainers.

## On this page

- [Runtime and support domains](#runtime-and-support-domains)
- [Internal domains](#internal-domains)

## Runtime and support domains

| Source root      | Concrete anchor                                                                             | Ownership and status                    | Behavior documentation                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `cli`            | [`src/cli/index.ts`](../../../src/cli/index.ts)                                             | implemented and public command dispatch | [Part 1](../01-boundaries-and-admission/README.md)                                        |
| `sweep`          | [`src/sweep/sweep-engine.ts`](../../../src/sweep/sweep-engine.ts)                           | implemented matrix orchestration        | [Matrix sweeps](../02-execution-and-artifacts/matrix-sweeps.md)                           |
| `runner`         | [`src/runner/runner-engine.ts`](../../../src/runner/runner-engine.ts)                       | implemented tool loop                   | [Runner and tools](../02-execution-and-artifacts/runner-and-tools.md)                     |
| `infrastructure` | [`src/infrastructure/container/pool.ts`](../../../src/infrastructure/container/pool.ts)     | implemented internal lifecycle          | [Part 3](../03-isolation-and-lifecycle/README.md)                                         |
| `providers`      | [`src/providers/factory.ts`](../../../src/providers/factory.ts)                             | fake public; live source-present        | [Part 4](../04-provider-boundary/README.md)                                               |
| `models`         | [`src/models/model-registry.ts`](../../../src/models/model-registry.ts)                     | implemented internal model selection    | [Adapter contract](../04-provider-boundary/adapter-contract.md)                           |
| `eval`           | [`src/eval/deterministic.ts`](../../../src/eval/deterministic.ts)                           | implemented evaluator primitives        | [Part 5](../05-evidence-and-evaluation/README.md)                                         |
| `shared`         | [`src/shared/benchmark-authority.ts`](../../../src/shared/benchmark-authority.ts)           | implemented authority contracts         | [Evidence authority](../05-evidence-and-evaluation/evidence-authority.md)                 |
| `reporting`      | [`src/reporting/db.ts`](../../../src/reporting/db.ts)                                       | implemented persisted reader storage    | [Part 6](../06-persistence-and-readers/README.md)                                         |
| `replay`         | [`src/replay/event-session-loader.ts`](../../../src/replay/event-session-loader.ts)         | implemented persisted replay reader     | [Reports, replay, and server](../06-persistence-and-readers/reports-replay-and-server.md) |
| `server`         | [`src/server/api-router.ts`](../../../src/server/api-router.ts)                             | implemented internal read-only server   | [Reports, replay, and server](../06-persistence-and-readers/reports-replay-and-server.md) |
| `skills`         | [`src/skills/registry.ts`](../../../src/skills/registry.ts)                                 | implemented catalog support             | [Catalog and admission](../01-boundaries-and-admission/catalog-and-admission.md)          |
| `scripts`        | [`src/scripts/operator-contract-smoke.ts`](../../../src/scripts/operator-contract-smoke.ts) | implemented maintainer verification     | [Part 8](../08-operations-and-testbed/README.md)                                          |

## Internal domains

| Source root | Concrete anchor                                                                           | Ownership and current status        | Behavior documentation                                                                    |
| ----------- | ----------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `analytics` | [`src/analytics/anomaly-detector.ts`](../../../src/analytics/anomaly-detector.ts)         | implemented internal analytics      | [Limitations](current-limitations.md)                                                     |
| `arena`     | [`src/arena/consensus-scorer.ts`](../../../src/arena/consensus-scorer.ts)                 | diagnostic only                     | [Arena and tournament](../07-diagnostics-and-internal-surfaces/arena-and-tournament.md)   |
| `chaos`     | [`src/chaos/chaos-engine.ts`](../../../src/chaos/chaos-engine.ts)                         | diagnostic only                     | [Chaos](../07-diagnostics-and-internal-surfaces/chaos.md)                                 |
| `dialog`    | [`src/dialog/stakeholder-simulator.ts`](../../../src/dialog/stakeholder-simulator.ts)     | implemented internal dialog support | [Limitations](current-limitations.md)                                                     |
| `generator` | [`src/generator/scenario-synthesizer.ts`](../../../src/generator/scenario-synthesizer.ts) | implemented internal generator      | [Limitations](current-limitations.md)                                                     |
| `optimizer` | [`src/optimizer/optimizer-engine.ts`](../../../src/optimizer/optimizer-engine.ts)         | implemented internal optimization   | [Limitations](current-limitations.md)                                                     |
| `streaming` | [`src/streaming/canvas-streamer.ts`](../../../src/streaming/canvas-streamer.ts)           | implemented internal presentation   | [Streaming and tunnels](../07-diagnostics-and-internal-surfaces/streaming-and-tunnels.md) |
| `tui`       | [`src/tui/canvas.ts`](../../../src/tui/canvas.ts)                                         | implemented internal presentation   | [Limitations](current-limitations.md)                                                     |
| `tunnel`    | [`src/tunnel/stream-tunnel.ts`](../../../src/tunnel/stream-tunnel.ts)                     | implemented internal transport      | [Streaming and tunnels](../07-diagnostics-and-internal-surfaces/streaming-and-tunnels.md) |

Every top-level source root has a concrete file anchor and a current status/behavior destination above.

## Source anchors

[`src/index.ts`](../../../src/index.ts) is the root barrel; the section indexes above identify ownership without treating that barrel as a stable public API.

## Limitations

All top-level `src/` directories are mapped here. Nested modules require a source anchor in the owning chapter before they gain a behavior claim.

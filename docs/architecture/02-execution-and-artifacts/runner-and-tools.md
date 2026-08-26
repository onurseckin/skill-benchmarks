# Runner and Tools

[Book index](../README.md) | [Part index](README.md) | [Previous: matrix sweeps](matrix-sweeps.md) | [Next: workspaces and artifacts](workspaces-and-artifacts.md)

**Status:** implemented, internal loop behind public execution.

`ScenarioRunnerEngine` creates a conversation, requests a provider turn, dispatches returned standard tools, records tool results, accumulates token/cost telemetry, and stops on terminal, budget, wall-clock, turn, or tool-failure conditions. The dispatcher validates tool names and workspace paths before calling handlers.

## Source anchors

[`src/runner/runner-engine.ts`](../../../src/runner/runner-engine.ts), [`src/runner/tool-dispatcher.ts`](../../../src/runner/tool-dispatcher.ts), [`src/runner/tool-handlers.ts`](../../../src/runner/tool-handlers.ts), and [`src/runner/context-manager.ts`](../../../src/runner/context-manager.ts).

## Limitations

Provider cancellation, retry, and streaming equivalence are not certified by this current implementation documentation.

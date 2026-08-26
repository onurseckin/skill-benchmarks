# Part 2: Execution and Artifacts

[Book index](../README.md) | [Previous: admission](../01-boundaries-and-admission/README.md) | [Next: isolation](../03-isolation-and-lifecycle/README.md)

**Status:** Implemented & public

Fake execution is implemented and public; evidence remains diagnostic unless eligible authority is present.

## Chapters

- [Matrix sweeps](matrix-sweeps.md)
- [Runner and tools](runner-and-tools.md)
- [Workspaces and artifacts](workspaces-and-artifacts.md)

## Source anchors

[`src/sweep/sweep-engine.ts`](../../../src/sweep/sweep-engine.ts), [`src/runner/runner-engine.ts`](../../../src/runner/runner-engine.ts), and [`src/sweep/run-evidence.ts`](../../../src/sweep/run-evidence.ts).

## Limitations

Execution success does not independently create a score, pass, rank, or actual-cost claim.

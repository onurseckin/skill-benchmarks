# Execution Modes

[Book index](../README.md) | [Part index](README.md) | [Next: catalog admission](catalog-and-admission.md)

**Status:** Implemented & public

The documented execution-mode behavior is implemented and public.

## Resolution

`resolveExecutionMode` chooses fake execution by default. `--mock` selects fake, `--live` selects live, and a valid `SKILL_BENCHMARKS_USE_MOCK` value selects when neither flag is present. Both flags together and invalid nonempty environment values fail configuration.

Fake adapters report simulated provenance and zero cost. The mode controls request construction; it does not authorize benchmark claims.

## Source anchors

[`src/shared/execution-mode.ts`](../../../src/shared/execution-mode.ts), [`src/shared/benchmark-runtime-config.ts`](../../../src/shared/benchmark-runtime-config.ts), and [`src/providers/mock-adapter.ts`](../../../src/providers/mock-adapter.ts).

## Limitations

Live mode needs a separate operator choice and credential preflight. No live behavior is verified by this book.

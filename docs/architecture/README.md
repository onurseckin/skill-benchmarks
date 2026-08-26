# Skill-Benchmarks Architecture Book

[Repository README](../../README.md) | [Usage guide](../usage-guide/README.md) | [Reading guide](00-reading-the-book.md) | [Limitations](appendices/current-limitations.md)

This book explains the checked-in implementation for maintainers and contributors. The [usage guide](../usage-guide/README.md) remains the concise authority for people running the repository.

## Status legend

- **Implemented and public**: reachable through the documented CLI or maintained operator gate.
- **Implemented, internal**: present in source but not a supported consumer workflow.
- **Diagnostic only**: records operational facts and cannot establish model-quality claims.
- **Planned or unavailable**: deliberately excluded from current behavior claims.

## Parts

1. [Boundaries and admission](01-boundaries-and-admission/README.md)
2. [Execution and artifacts](02-execution-and-artifacts/README.md)
3. [Isolation and lifecycle](03-isolation-and-lifecycle/README.md)
4. [Provider boundary](04-provider-boundary/README.md)
5. [Evidence and evaluation](05-evidence-and-evaluation/README.md)
6. [Persistence and readers](06-persistence-and-readers/README.md)
7. [Diagnostics and internal surfaces](07-diagnostics-and-internal-surfaces/README.md)
8. [Operations and testbed](08-operations-and-testbed/README.md)
9. [Appendices](appendices/README.md)

## Source anchors

The implementation entry points are [`src/cli/index.ts`](../../src/cli/index.ts), [`src/sweep/sweep-engine.ts`](../../src/sweep/sweep-engine.ts), and [`src/shared/benchmark-authority.ts`](../../src/shared/benchmark-authority.ts).

## Limitations

This book makes no live-provider, ranked competition, resilience, or public streaming claim beyond the evidence listed in [current limitations](appendices/current-limitations.md).

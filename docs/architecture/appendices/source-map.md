# Source Map

[Book index](../README.md) | [Appendix index](README.md) | [Limitations](current-limitations.md)

**Status:** current ownership map.

## On this page

- [Runtime and support domains](#runtime-and-support-domains)
- [Internal domains](#internal-domains)

## Runtime and support domains

| Source root                     | Ownership                                       | Book location                                                     |
| ------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| `cli`                           | public command parsing and dispatch             | [Part 1](../01-boundaries-and-admission/README.md)                |
| `sweep`, `runner`               | matrix execution and tool loop                  | [Part 2](../02-execution-and-artifacts/README.md)                 |
| `infrastructure`                | containers, workspaces, telemetry               | [Part 3](../03-isolation-and-lifecycle/README.md)                 |
| `providers`, `models`           | fake/live adapter and model selection           | [Part 4](../04-provider-boundary/README.md)                       |
| `eval`, `shared`                | evidence contracts and shared authority         | [Part 5](../05-evidence-and-evaluation/README.md)                 |
| `reporting`, `replay`, `server` | persisted readers and publication               | [Part 6](../06-persistence-and-readers/README.md)                 |
| `skills`                        | canonical skill catalog support                 | [Part 1](../01-boundaries-and-admission/catalog-and-admission.md) |
| `scripts`                       | maintained verification and maintenance scripts | [Part 8](../08-operations-and-testbed/README.md)                  |

## Internal domains

| Source root                                     | Ownership                             | Current status        |
| ----------------------------------------------- | ------------------------------------- | --------------------- |
| `arena`, `chaos`                                | unranked diagnostics                  | diagnostic only       |
| `streaming`, `tunnel`, `tui`                    | presentation and transport components | implemented, internal |
| `analytics`, `dialog`, `generator`, `optimizer` | exploratory or support modules        | implemented, internal |

Mapped roots: `analytics`, `arena`, `chaos`, `cli`, `dialog`, `eval`, `generator`, `infrastructure`, `models`, `optimizer`, `providers`, `replay`, `reporting`, `runner`, `scripts`, `server`, `shared`, `skills`, `streaming`, `sweep`, `tui`, and `tunnel`.

## Source anchors

[`src/index.ts`](../../../src/index.ts) is the root barrel; the section indexes above identify ownership without treating that barrel as a stable public API.

## Limitations

All top-level `src/` directories are mapped here. Nested modules require a source anchor in the owning chapter before they gain a behavior claim.

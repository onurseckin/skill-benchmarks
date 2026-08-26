# Reading the Book

[Book index](README.md) | [First part](01-boundaries-and-admission/README.md) | [Appendices](appendices/README.md)

## On this page

- [Audience](#audience)
- [How claims are labeled](#how-claims-are-labeled)
- [Documentation boundary](#documentation-boundary)

## Audience

Read this book when changing repository internals, verification, or persisted evidence. Read the [usage guide](../usage-guide/README.md) when operating the CLI.

**Status:** current documentation navigation and scope guidance.

## How claims are labeled

Every topic identifies its status and links to the files that establish it. An internal module is not automatically a supported public feature. A diagnostic output is not a benchmark result.

## Documentation boundary

Commands, option matrices, credentials, and copy-paste workflows belong to the usage guide. This book records data ownership, failure boundaries, and why unproven outputs stay absent.

## Source anchors

[`README.md`](../../README.md), [`docs/usage-guide/README.md`](../usage-guide/README.md), and [`src/scripts/operator-contract-smoke.ts`](../../src/scripts/operator-contract-smoke.ts).

## Limitations

The book is a source map, not a live certification. The maintained verification gate removes provider credentials and does not call live providers.

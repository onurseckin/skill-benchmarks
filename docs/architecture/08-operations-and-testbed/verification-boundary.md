# Verification Boundary

[Book index](../README.md) | [Part index](README.md) | [Next: testbed delivery](testbed-delivery.md)

**Status:** implemented maintainer verification.

`bun run test` runs typechecking and the operator contract. The contract runs isolated no-key cases for static inventory, catalog, admission, fake artifacts, runtime behavior, CLI failure modes, persisted readers, server output, testbed delivery, workflow identity, and documentation.

Maintenance scripts are separate from public CLI commands. `sync:skills` can read a catalog and write a destination; use `--dry-run` first. `verify:ci-diagnostic` reads and validates exactly one existing diagnostic bundle. `gc:containers` is destructive Docker cleanup for managed containers and workspace volumes.

## Source anchors

[`package.json`](../../../package.json), [`src/scripts/operator-contract-smoke.ts`](../../../src/scripts/operator-contract-smoke.ts), [`src/scripts/sync-skills.ts`](../../../src/scripts/sync-skills.ts), [`src/scripts/verify-ci-diagnostic.ts`](../../../src/scripts/verify-ci-diagnostic.ts), and [`src/infrastructure/container/gc.ts`](../../../src/infrastructure/container/gc.ts).

## Limitations

Do not treat maintenance scripts as consumer features. Never run `gc:containers` without confirming its managed-resource scope; its package entry point does not expose a dry-run argument.

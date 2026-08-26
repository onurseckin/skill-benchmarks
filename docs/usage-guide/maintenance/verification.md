# Maintainer Verification

[Usage guide](../README.md) | [Testbed delivery](testbed-delivery.md) | [Repository README](../../../README.md#maintainer-verification)

The maintained delivery gate is deterministic and no-key. It removes Anthropic, OpenAI, and Google credential variables, uses isolated temporary roots, and never invokes a live provider.

## Prerequisites

- Bun 1.3.14 for the pinned CI/runtime contract
- Go 1.22 or newer for the testbed workload
- A running Docker engine for the container lifecycle gate

## Run the complete public gate

```bash
bun run test
```

The package `test` script runs root typechecking and the operator contract. The operator contract verifies these named boundaries:

- maintained source and scenario catalog
- selector admission
- no-key fake execution and reconciled artifacts
- invalid and non-TTY CLI behavior
- replay round trip and report cohorts
- local read-only server and dashboard output
- copied testbed local and Docker lifecycles
- exact CI workflow command

Every case receives its own temporary root, removes provider keys, checks the checkout before and after, and cleans up owned processes, containers, images, and temporary files.

## Run focused gates

```bash
bun run typecheck
bun run src/scripts/quality-gate.ts
bun run src/scripts/operator-contract-smoke.ts
bun run --cwd testbed typecheck
(cd testbed/microservice && go test ./...)
```

The quality gate scans maintained TypeScript, TSX, JavaScript, shell, Go, and Dockerfile source in `src`, `bin`, `testbed`, and `docker`. Dependencies and generated `dist` output are excluded. Maintained source must contain zero comments and remain below 400 lines; shebangs and the required Docker syntax directive are allowed.

## CI behavior

The `Simulated Operator Diagnostic` workflow installs the frozen root dependency graph and invokes exactly:

```bash
bun run test
```

It then runs one separately reconciled fake trajectory and uploads `simulated-diagnostic-<sha>`. That bundle demonstrates installed-command operation, persistence, terminal reconciliation, and diagnostic report empty-state behavior. It does not publish model-quality evidence, rankings, or regression decisions.

## Maintainer-only maintenance scripts

These package scripts are not public `skill-benchmarks` commands and are not part of the normal consumer workflow.

`bun run sync:skills` reads a skills catalog and can download/cache skills below its destination. Run `bun run sync:skills --dry-run --limit 1` before a real synchronization; do not use `--force` until the destination is confirmed. A real synchronization can make network requests and write catalog/cache files.

`bun run verify:ci-diagnostic <bundle-directory>` validates one existing CI diagnostic bundle. It reads the bundle, its database, events, artifacts, and report; it does not run a provider or create benchmark evidence.

`bun run gc:containers` is destructive cleanup. It kills/removes Docker resources labeled as managed by this project and removes labeled workspace volumes. Its package entry point exposes no dry-run flag, so inspect the Docker environment and use it only when removal is intended.

## Before committing

```bash
bunx oxfmt --check README.md docs/usage-guide src/scripts package.json .github/workflows/benchmark-matrix.yml
bunx oxlint src/scripts
git diff --check
git status --short
```

Run the complete gate after the final edit rather than relying on an earlier result.

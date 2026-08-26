# Workspaces and Artifacts

[Book index](../README.md) | [Part index](README.md) | [Previous: runner and tools](runner-and-tools.md) | [Next part: isolation](../03-isolation-and-lifecycle/README.md)

**Status:** Implemented but not public

Workspace and artifact handling is implemented with canonical artifact authority.

Each cell prepares a run layout below the output root, writes a manifest before execution, and atomically commits a result or terminal-failure artifact. Disposable workspaces use run and scenario identity; terminal records bind the same identity before database persistence.

## Source anchors

[`src/infrastructure/workspace/run-artifact-layout.ts`](../../../src/infrastructure/workspace/run-artifact-layout.ts), [`src/infrastructure/workspace/run-artifact-authority.ts`](../../../src/infrastructure/workspace/run-artifact-authority.ts), [`src/infrastructure/workspace/disposable-workspace.ts`](../../../src/infrastructure/workspace/disposable-workspace.ts), and [`src/sweep/run-evidence.ts`](../../../src/sweep/run-evidence.ts).

## Limitations

Exports are derived reader outputs, not canonical run evidence. Workspace disposal or a failed terminal write prevents eligible claims.

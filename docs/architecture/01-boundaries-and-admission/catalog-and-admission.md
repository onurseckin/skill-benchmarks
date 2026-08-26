# Catalog and Admission

[Book index](../README.md) | [Part index](README.md) | [Previous: execution modes](execution-modes.md) | [Next: CLI control plane](cli-control-plane.md)

**Status:** implemented and public.

`ScenarioLoader` reads the package-owned scenario catalog, rejects malformed, duplicate, escaped, or identity-mismatched entries, then resolves scenario definitions. `SkillRegistry` preloads canonical skill manifests. Sweep admission validates selectors before runtime artifacts are created.

## Source anchors

[`src/runner/scenario-loader.ts`](../../../src/runner/scenario-loader.ts), [`src/skills/registry.ts`](../../../src/skills/registry.ts), and [`src/sweep/sweep-config-validation.ts`](../../../src/sweep/sweep-config-validation.ts).

## Limitations

Checked-in catalog selection is public; custom scenario authoring is explicitly unavailable in the [usage guide](../../usage-guide/custom-scenarios/authoring-scenarios.md).

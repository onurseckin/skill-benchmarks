# Terminology

[Book index](../README.md) | [Appendix index](README.md) | [Limitations](current-limitations.md)

**Status:** current terminology reference.

## Terms

- **Authority**: the evidence-backed classification that decides whether benchmark claims may exist.
- **Canonical artifact**: a manifest, result, event stream, or database record bound to one run identity.
- **Diagnostic**: operational information that is not eligible for benchmark-quality claims.
- **Fake execution**: deterministic simulated provider execution with zero cost.
- **Eligible**: complete, integrity-verified evidence with an evaluated outcome and no ineligibility reasons.
- **Internal surface**: source code present in the repository but not a supported consumer workflow.

## Source anchors

[`src/shared/benchmark-authority.ts`](../../../src/shared/benchmark-authority.ts), [`src/reporting/types.ts`](../../../src/reporting/types.ts), and [`src/replay/types.ts`](../../../src/replay/types.ts).

## Limitations

Terms describe the checked-in contracts and do not imply that every source export is public API.

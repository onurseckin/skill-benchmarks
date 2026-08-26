# Evidence Authority

[Book index](../README.md) | [Part index](README.md) | [Next: deterministic evaluation](deterministic-evaluation.md)

**Status:** Implemented but not public

The evidence authority is implemented and fail-closed.

`classifyBenchmarkAuthority` accepts a complete benchmark authority only when lifecycle status, provenance, evidence identity, integrity, evaluator identity, digest, evaluation, and cost evidence agree. Otherwise it preserves diagnostic facts while removing score, pass, rank, and actual-cost claim fields.

Fake, simulated, dry, incomplete, failed, timed-out, aborted, invalid, or unevaluated records are not eligible.

## Source anchors

[`src/shared/benchmark-authority.ts`](../../../src/shared/benchmark-authority.ts), [`src/eval/evidence-contract.ts`](../../../src/eval/evidence-contract.ts), and [`src/sweep/run-evidence.ts`](../../../src/sweep/run-evidence.ts).

## Limitations

Eligibility is an authority boundary, not proof that a particular live scenario evaluator currently executes.

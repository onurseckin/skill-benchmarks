# Deterministic Evaluation

[Book index](../README.md) | [Part index](README.md) | [Previous: evidence authority](evidence-authority.md) | [Next part: readers](../06-persistence-and-readers/README.md)

**Status:** Implemented but not public

Evaluator primitives are implemented; lifecycle integration remains limited.

`DeterministicVerificationEngine` rejects empty declarations as not evaluated, validates declared checks, executes checks inside a supplied workspace, and produces a weighted summary and digest only for valid results. Evidence-contract construction validates identity and composite arithmetic before it can form complete evidence.

## Source anchors

[`src/eval/deterministic.ts`](../../../src/eval/deterministic.ts), [`src/eval/deterministic-check-executor.ts`](../../../src/eval/deterministic-check-executor.ts), [`src/eval/scoring.ts`](../../../src/eval/scoring.ts), and [`src/eval/evidence-contract.ts`](../../../src/eval/evidence-contract.ts).

## Limitations

Current scenario execution does not document a general declared-check lifecycle that can make fake runs eligible. Judge/ranking behavior is unavailable.

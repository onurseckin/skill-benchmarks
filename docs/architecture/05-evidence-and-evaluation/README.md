# Part 5: Evidence and Evaluation

[Book index](../README.md) | [Previous: providers](../04-provider-boundary/README.md) | [Next: readers](../06-persistence-and-readers/README.md)

**Status:** implemented authority boundary; benchmark eligibility is deliberately fail-closed.

## Chapters

- [Evidence authority](evidence-authority.md)
- [Deterministic evaluation](deterministic-evaluation.md)

## Source anchors

[`src/shared/benchmark-authority.ts`](../../../src/shared/benchmark-authority.ts), [`src/eval/evidence-contract.ts`](../../../src/eval/evidence-contract.ts), and [`src/eval/deterministic.ts`](../../../src/eval/deterministic.ts).

## Limitations

Current fake runs are simulated and ineligible; declared evaluator execution remains a readiness-plan item.

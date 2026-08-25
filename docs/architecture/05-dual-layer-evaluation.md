# Chapter 05: Evidence Eligibility and Evaluation

[← Previous: 04. Runner & Tool Interceptor](04-runner-and-interceptor.md) | [Architecture Index](README.md) | [Next: 06. Telemetry & Reporting →](06-telemetry-and-reporting.md)

## 1. Benchmark Authority Boundary

Evaluation claims are optional outputs backed by persisted evidence. A completed command, a successful tool exit, or a provider response does not independently establish a benchmark score or pass result.

[`src/shared/benchmark-authority.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/shared/benchmark-authority.ts) is the authority boundary. An eligible record must bind execution provenance, lifecycle completion, artifact integrity, cost verification, evidence identity, evaluation identity, and exact score/pass columns. Invalid or incomplete inputs produce diagnostic ineligibility without score or pass fields.

## 2. Evidence Flow

```text
declared checks
    |
    v
executed deterministic evidence ---- optional judge evidence
    |                                      |
    +------------------+-------------------+
                       v
              composite evaluation
                       |
                       v
              evidence digest binding
                       |
                       v
             benchmark authority check
                |               |
                v               v
          eligible claims   diagnostic absence
```

[`src/eval/deterministic.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/eval/deterministic.ts) requires at least one declared and executed deterministic check. [`src/eval/composite-evaluator.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/eval/composite-evaluator.ts) refuses judge-only and malformed summaries. [`src/eval/evidence-adapter.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/eval/evidence-adapter.ts) binds the accepted structures and identities into a digest before persistence.

## 3. Absence Instead of Synthetic Claims

Unavailable evaluation is represented by discriminated states such as `not_evaluated` or `invalid`. Those states do not carry numerical score, pass, rank, rating, winner, or confidence properties. This keeps diagnostic runs useful without allowing placeholders to enter reports.

Fake provider runs are always simulated and remain outside eligible benchmark cohorts. They verify orchestration and artifacts, not model quality.

## 4. Arena and Tournament Boundary

[`src/runner/arena-runner.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/arena-runner.ts) and [`src/runner/tournament-planner.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/tournament-planner.ts) expose only plans and candidate diagnostics. They do not infer pairwise outcomes from provider text or update persistent ratings.

A future ranked comparison would require durable candidate evidence plus a persisted match and judge protocol bound to the same identity. Until that complete evidence contract exists, live comparison fails closed and fake comparison remains `SIMULATED / UNRANKED`.

## 5. Evaluation Module Reference

- [`src/eval/deterministic.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/eval/deterministic.ts): validates nonempty deterministic check evidence.
- [`src/eval/composite-evaluator.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/eval/composite-evaluator.ts): combines validated evidence without creating fallback claims.
- [`src/eval/evidence-adapter.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/eval/evidence-adapter.ts): binds accepted evidence to an identity and digest.
- [`src/shared/benchmark-authority.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/shared/benchmark-authority.ts): classifies eligible and diagnostic records.
- [`src/runner/arena-runner.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/arena-runner.ts): emits unranked arena plans and diagnostics.
- [`src/runner/tournament-planner.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/runner/tournament-planner.ts): creates immutable pairing plans without standings.

[← Previous: 04. Runner & Tool Interceptor](04-runner-and-interceptor.md) | [Architecture Index](README.md) | [Next: 06. Telemetry & Reporting →](06-telemetry-and-reporting.md)

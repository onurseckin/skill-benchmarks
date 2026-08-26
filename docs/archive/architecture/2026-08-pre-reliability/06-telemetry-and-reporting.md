# Chapter 06: Telemetry Storage and Reporting

[← Previous: 05. Evidence Eligibility & Evaluation](05-dual-layer-evaluation.md) | [Architecture Index](README.md) | [Next: 07. Chaos Fault Injection →](07-fuzzing-and-chaos.md)

## 1. Canonical Persistence

[`src/reporting/db.ts`](../../../../src/reporting/db.ts) stores run records, explicit claim rows, and telemetry events in SQLite. Schema version 3 has no rating table. Opening a version 2 database removes its retired rating history because those rows lack durable match evidence.

Run records keep operational provenance even when evaluation is unavailable. Claim columns are present only for evidence-eligible runs and must agree with the structured evaluation payload.

## 2. Eligible Query Boundary

[`src/reporting/query-store.ts`](../../../../src/reporting/query-store.ts) reconstructs stored records and validates them through the shared benchmark authority before exposing eligible queries. A database label alone cannot authorize a score or pass claim.

```text
SQLite row
   |
   v
structured record reconstruction
   |
   v
authority validation
   |                    |
   v                    v
eligible query       diagnostic query
score/pass present   claims absent
```

## 3. Reporting Cohorts

Reports distinguish matched diagnostic runs from eligible scoring cohorts. Filters apply to scenario, category, skill, model, provider, lifecycle, execution mode, simulation provenance, authority, cohort, eligibility, evidence, evaluation, and date boundaries.

Aggregates disclose their sample counts and cohort filters. Empty eligible cohorts state that scoring evidence is unavailable; they do not emit default rankings or zero-valued model quality claims.

## 4. Publication

JSON, Markdown, HTML, and card renderers consume one validated snapshot. Requested outputs are rendered and preflighted before publication. Output paths cannot overlap the source database, and grouped publication rejects invalid destinations without replacing earlier outputs.

Persisted identifiers are escaped for their output context. API query errors are separated from persisted evidence failures so malformed filters produce `400` while corrupt stored evidence produces `500`.

## 4. Telemetry Module Reference

- [`src/reporting/db.ts`](../../../../src/reporting/db.ts): database lifecycle and query facade.
- [`src/reporting/schema.ts`](../../../../src/reporting/schema.ts): exact schema validation and retired rating migration.
- [`src/reporting/query-store.ts`](../../../../src/reporting/query-store.ts): authority-validated run queries.
- [`src/reporting/report-cohorts.ts`](../../../../src/reporting/report-cohorts.ts): cohort filters and disclosure metadata.
- [`src/reporting/aggregator.ts`](../../../../src/reporting/aggregator.ts): observed eligible-run aggregation.
- [`src/reporting/report-output.ts`](../../../../src/reporting/report-output.ts): grouped output publication.

[← Previous: 05. Evidence Eligibility & Evaluation](05-dual-layer-evaluation.md) | [Architecture Index](README.md) | [Next: 07. Chaos Fault Injection →](07-fuzzing-and-chaos.md)

# SQLite and Run Records

[Book index](../README.md) | [Part index](README.md) | [Next: reports, replay, and server](reports-replay-and-server.md)

**Status:** implemented persisted evidence store.

`TelemetryDatabase` owns schema access and authority-aware run records. Terminal persistence binds artifacts and database identities. Query code reconstructs stored records and report cohorts separate eligible evidence from diagnostic material.

## Source anchors

[`src/reporting/db.ts`](../../../src/reporting/db.ts), [`src/reporting/schema.ts`](../../../src/reporting/schema.ts), [`src/reporting/run-store.ts`](../../../src/reporting/run-store.ts), [`src/reporting/query-store.ts`](../../../src/reporting/query-store.ts), and [`src/reporting/report-cohorts.ts`](../../../src/reporting/report-cohorts.ts).

## Limitations

A database row alone does not authorize benchmark claims. Missing databases are reader errors rather than opportunities to create sample data.

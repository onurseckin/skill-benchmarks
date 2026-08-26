# Part 6: Persistence and Readers

[Book index](../README.md) | [Previous: evidence](../05-evidence-and-evaluation/README.md) | [Next: diagnostics](../07-diagnostics-and-internal-surfaces/README.md)

**Status:** Implemented & public

Implemented readers consume persisted evidence.

## Chapters

- [SQLite and run records](sqlite-and-run-records.md)
- [Reports, replay, and server](reports-replay-and-server.md)

## Source anchors

[`src/reporting/db.ts`](../../../src/reporting/db.ts), [`src/replay/event-session-loader.ts`](../../../src/replay/event-session-loader.ts), and [`src/server/api-router.ts`](../../../src/server/api-router.ts).

## Limitations

Readers do not manufacture missing evidence, ranking, or live streams.

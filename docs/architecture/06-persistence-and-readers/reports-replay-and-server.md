# Reports, Replay, and Server

[Book index](../README.md) | [Part index](README.md) | [Previous: SQLite and run records](sqlite-and-run-records.md) | [Next part: diagnostics](../07-diagnostics-and-internal-surfaces/README.md)

**Status:** implemented persisted-evidence readers.

Reports build a cohort snapshot before console, JSON, Markdown, HTML, or card publication. Replay validates direct or canonical persisted evidence and refuses missing or inconsistent sessions. The local reader validates an existing loopback output root and database, exposes read-only routes, and turns unavailable or invalid replay into safe responses.

## Source anchors

[`src/reporting/report-cohorts.ts`](../../../src/reporting/report-cohorts.ts), [`src/cli/commands/report.ts`](../../../src/cli/commands/report.ts), [`src/replay/event-session-loader.ts`](../../../src/replay/event-session-loader.ts), [`src/cli/commands/replay.ts`](../../../src/cli/commands/replay.ts), [`src/server/server-authority.ts`](../../../src/server/server-authority.ts), and [`src/server/api-router.ts`](../../../src/server/api-router.ts).

## Limitations

Readers preserve or disclose persisted facts; they do not create scores, frames, rankings, writes, or live-stream mutation routes.

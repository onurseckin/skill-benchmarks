# ADR-0001: Establish a Versioned Safe Artifact Boundary

## Status

Accepted

## Date

2026-08-25

## Context

Skill Benchmarks persists provider, runner, tool, workspace, database, report, replay, server, and tunnel data. A completed fake-first foundation made execution mode, run provenance, and terminal evidence trustworthy, but cross-capsule review showed that confidentiality and safe publication need a dedicated contract. Raw data can carry credentials, authorization material, sensitive URLs, opaque tokens, untrusted HTML, or model and tool output that must not become durable evidence or a browser sink.

The repository must remain usable without provider credentials, preserve typed operational metrics, retain isolated durable evidence, and avoid compatibility reads of artifacts created before the disclosure contract.

## Decision

All data crossing from execution into a durable or public boundary uses one versioned disclosure conversion. The conversion returns only bounded plain JSON-compatible values and separates typed evidence from arbitrary untrusted content. It fails closed for unknown objects, unsafe identifiers, conversion errors, credential-shaped text, and unsafe byte sequences.

Durable run evidence and ephemeral workspaces are physically separate. Workspaces, raw diffs, container-authored paths, command fragments, and raw provider diagnostics are never retained within a run artifact tree. Every durable record and database carries a disclosure-policy version. Report, export, replay, HTTP, SSE, and tunnel readers reject data without the current version.

The server and tunnel are loopback-only. This decision deliberately rejects remote publication until a separate browser authentication and session design exists.

## Alternatives Considered

### Per-writer redaction

Rejected because independent writers inevitably drift, can sanitize after persistence, and cannot cover database sidecars, backups, or future exports.

### Redact only known API-key names

Rejected because authorization values, signed URLs, cookies, opaque tokens, encoded data, bytes, and provider-specific keys bypass a key-name-only rule.

### Preserve raw artifacts with restrictive access controls

Rejected because local files, generated reports, and tunnel streams can still be copied or exposed. The benchmark evidence contract must be safe before access controls are applied.

### Support remote publication with a token query parameter

Rejected because query tokens leak through logs, browser history, referrers, and proxies. A viable remote-browser session design is out of scope.

## Consequences

- Safe conversion and storage are mandatory before each persistence or public-output boundary.
- Existing unversioned artifacts are intentionally incompatible with reports, exports, replay, and server paths.
- Dynamic detail may be omitted or summarized instead of retained verbatim.
- Workspace disposal becomes a local containment requirement now and a common finalizer requirement in the lifecycle-drain capsule.
- Operator truthfulness, browser accessibility, provider transport semantics, and score eligibility remain owned by their dedicated later capsules.

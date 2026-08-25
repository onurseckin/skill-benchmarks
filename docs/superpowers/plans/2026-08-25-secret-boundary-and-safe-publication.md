# Secret Boundary and Safe Publication Plan

> **Implementation rule:** Execute one task at a time on `main`. Run the named read-only audit lanes in parallel. Every task must pass `bun run typecheck`, `bun run src/scripts/quality-gate.ts`, deterministic no-key probes, fresh review, an atomic Conventional Commit, and `git push origin main`.

**Goal:** Prevent credentials, authorization data, signed URLs, opaque tokens, unsafe identifiers, raw workspace output, and executable captured HTML from reaching durable artifacts or public surfaces.

**Architecture:** ADR-0001 establishes a single versioned disclosure conversion. Typed evidence is allowlisted. Arbitrary content is untrusted and fails closed. Durable evidence is separated from ephemeral workspaces. Public readers reject older or unversioned records. Server and tunnel services remain loopback-only.

## Task 1: Create a Typed Disclosure Boundary

**Files:** Create `src/shared/disclosure/{types,value,text,url,failure,index}.ts`; replace `src/shared/artifact-sanitization.ts`; update `src/shared/index.ts`, sweep callers, and telemetry callers.

**Work:** Add typed and untrusted disclosure profiles. Normalize sensitive key forms. Redact authorization, cookies, URLs, PEM/JWT/token patterns, encoded forms, bytes, cycles, getters, maps, and sets. Emit finite public failures and neutral opaque artifact identifiers.

**Verify:** A no-key Bun probe passes nested values, fragmented data, bytes, cyclic records, getters, URLs, headers, provider tokens, and errors through conversion; no canary survives while trusted metrics remain typed.

**Commit:** `feat(security): add typed disclosure boundary`

## Task 2: Physically Contain Artifacts

**Files:** Update telemetry scribe and diagnostics, checkpoint and evidence writers, disposable workspace, run layout, diff handling, sweep cell/sweep engine, and runner engine. Add one bounded runtime verifier under `src/scripts/` only if required.

**Work:** Persist only completed policy-sanitized stream summaries. Validate checkpoint and backup writes. Move raw workspaces outside durable run trees and dispose them in local finalizers. Quarantine container output. Omit raw/binary diffs. Use neutral paths for unsafe identifiers.

**Verify:** Success, provider failure, tool failure, timeout, and abort probes scan the complete output root, filenames, SQLite files and sidecars after close. No workspace remains below `runs/`; typed metrics survive.

**Commit:** `fix(artifacts): contain untrusted benchmark output`

## Task 3: Publish Safe Provider and Runner Failures

**Files:** Update provider types/factory/adapters, runner types/engine/matrix runner, affected sweep files, and active CLI error formatting.

**Work:** Keep raw provider data private to active control flow. Publish only disclosure-converted failures and tool/model summaries. Keep fake mode authoritative and zero-cost even with credential markers present.

**Verify:** Successful and failed fake runs with credential, provider-error, and tool-error canaries expose only stable public failures; full-root scan remains clean and fake invokes no network client.

**Commit:** `fix(providers): publish safe benchmark failures`

## Task 4: Enforce Safe Database and Export Records

**Files:** Update reporting database/types and active reporting/export writers; update active CLI/arena paths only at record-writer boundaries.

**Work:** Convert every dynamic database binding and output record. Store the policy version. Refuse older or unversioned input with a stable error. Convert data again at each JSON, Markdown, HTML, report-card, leaderboard, and CLI export boundary.

**Verify:** Marker-bearing records leave no logical or physical SQLite/sidecar data after close, each active export scans clean, and an unversioned fixture is rejected without echoing content.

**Commit:** `fix(reporting): enforce safe benchmark records`

## Task 5: Render Replay and Dashboard Data Safely

**Files:** Update replay engine/web player/types, dashboard UI app/components/types, and active server render payloads.

**Work:** Deliver captured values to generated HTML only through fixed element construction, `textContent`, or a reviewed escaping boundary. Remove captured-to-`innerHTML` flows. Bound values. Return unavailable when safe replay evidence does not exist.

**Verify:** Safe-record replay/dashboard exports with secret and HTML/script canaries contain neither canaries nor executable fragments; changed captured-data paths have no unrestricted HTML sink.

**Commit:** `fix(replay): render benchmark evidence safely`

## Task 6: Restrict HTTP and SSE to Loopback

**Files:** Update server types, HTTP server, API router, and only live-stream code incompatible with local-only operation.

**Work:** Default to loopback and reject non-loopback configuration. Remove wildcard CORS. Bound request/SSE payloads and clients. Convert at ingress and egress. Publish only safe versioned data and stable errors.

**Verify:** An ephemeral loopback server rejects remote bind, oversized/malformed telemetry, wildcard CORS, and marker persistence to DB/API/SSE; exact listener shutdown succeeds.

**Commit:** `fix(server): confine telemetry to loopback`

## Task 7: Restrict Interactive Tunnels to Loopback

**Files:** Update tunnel types, stream tunnel, and PTY multiplexer where limits require it.

**Work:** Reject remote bind, remove query-token authentication, bound sessions and frames, and disclosure-convert every text or JSON frame sent to WebSocket or SSE clients.

**Verify:** Loopback-only probe rejects remote configuration and malformed frames; marker-bearing terminal text never reaches WebSocket or SSE; exact shutdown succeeds.

**Commit:** `fix(tunnel): confine interactive streams to loopback`

## Task 8: Document the Boundary and Run the Final Harness

**Files:** Update only documentation that describes implemented disclosure, artifact, and local-service contracts. Extend the dedicated verifier if necessary.

**Work:** Document policy-version refusal, durable-versus-ephemeral evidence, redaction/omission limits, fake no-network behavior, and local-only sharing. Do not claim remote support or universal secret recognition.

**Verify:** Final harness reaches supported no-key terminal paths and exports under one exact temporary root, closes the database, scans every byte/path/sidecar, and leaves the checkout clean.

**Commit:** `docs(security): document safe benchmark artifacts`

## Parallel Read-Only Lanes

- Adversarial disclosure testing during Tasks 1–4.
- Provider credential-transport audit during Task 3.
- Presentation security review during Task 5.
- Lifecycle finalizer planning during Tasks 2–8.
- Delivery-stability audit during Tasks 4–8.

## Explicit Deferrals

Lifecycle drain owns scheduler-wide finalization. Evidence-gated evaluation owns pass/score eligibility. Operator surface owns fabricated-state removal and accessibility. Provider readiness owns retries, tool protocols, pricing, and live admission. Remote publication remains unsupported.

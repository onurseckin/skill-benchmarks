# Foundation Sealing Repair Plan

> **Implementation rule:** One source-writing agent operates on `main` at a time. Each task gets independent review, runtime no-key probes, `bun run typecheck`, `bun run src/scripts/quality-gate.ts`, an atomic Conventional Commit, and immediate `git push origin main`.

**Goal:** Close the cross-task gaps found by whole-foundation review before the secret-boundary capsule builds on its contracts.

## Task 1: Make Runtime Authority and Run Identity Unambiguous

**Files:** Modify `src/sweep/sweep-engine.ts`, `src/sweep/cell-execution.ts`, and sweep types only as required.

**Work:** Resolved runtime mode must always select the factory adapter. A caller-provided model adapter may be used only when its execution mode and simulation state match the resolved cell mode; otherwise reject it before run execution. Fake mode never accepts a live-capable adapter and always persists zero actual cost. Derive a unique run/cell identity from matrix occurrence as well as descriptor values; duplicate inputs must produce distinct artifacts and SQLite rows, not upserts.

**Verify:** No-key programmatic and CLI fake sweeps with an embedded live-looking adapter prove rejection or fake factory replacement, zero cost, and fake provenance. A duplicate-model matrix produces two distinct run directories, result files, and database records.

**Commit:** `fix(sweep): enforce runtime authority and unique runs`

## Task 2: Make Terminal Evidence Atomic and Required

**Files:** Modify `src/sweep/cell-execution.ts`, `src/sweep/run-evidence.ts`, artifact layout helpers, and types only as necessary.

**Work:** A terminal success is reported only after its manifest, result, and database record are durable. Result-write failure becomes a safe failed terminal record with no abandoned temporary artifact. Preserve exactly-one terminal record semantics for success, setup failure, error, timeout, and abort.

**Verify:** Force a result target collision and an atomic-write failure under a known temporary root. Assert nonzero failure status, one terminal database record, no completed claim, no temporary result files, and a safe manifest/result fallback where contractually possible.

**Commit:** `fix(evidence): require durable terminal artifacts`

## Task 3: Seal Public Artifacts and Operator Contracts

**Files:** Modify `src/shared/artifact-sanitization.ts`, event-scribe/runner layout handoff, report database opening path, CLI parser/help or commands, and exact docs only as needed.

**Work:** Treat Basic authorization as sensitive alongside current authorization handling. Place events at the canonical run artifact path rather than the mutable workspace. Report commands reject an absent database instead of creating an empty one. Make displayed concurrency default agree with actual CLI behavior.

**Verify:** Basic-authorization canary scan covers events, checkpoint, result, database, and workspace. A fake run writes canonical root-level events. A missing report database exits nonzero without creating a file. Help and execution agree on the concurrency default.

**Commit:** `fix(cli): seal artifact and report contracts`

## Whole-Repair Review

Fresh reviewer repeats the final-foundation probes and the root contract fuzzer. No source or docs changes are accepted until `main`, `origin/main`, and the review head agree.

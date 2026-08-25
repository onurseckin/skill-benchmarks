# Operator Truth and Delivery Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every existing operator, automation, provider, and lifecycle surface fail closed or report only evidence it can prove, without adding a product feature or preserving unhealthy compatibility behavior.

**Architecture:** The repair starts by admitting only resolvable benchmark inputs and by making benchmark eligibility an explicit persisted gate. Replay, reporting, arena, tournament, and CI then consume that gate or report an unavailable/unranked state. After the public contract is truthful, the package CLI, server/dashboard, testbed, and integration gates are repaired; provider and lifecycle work lands last so live eligibility can depend on complete cancellation, drain, protocol, streaming, model, and pricing evidence.

**Tech Stack:** Bun 1.3.14, TypeScript strict mode, Bun SQLite, GitHub Actions, Docker, Go testbed microservice, deterministic no-key Bun smoke scripts.

**Spec:** `docs/superpowers/specs/2026-08-25-benchmark-reliability-program-design.md`

**Audit inputs:** `.superpowers/sdd/2026-08-25-stability-loop/operator-delivery-health-audit.md` and `.superpowers/sdd/2026-08-25-stability-loop/provider-runtime-health-audit.md`

## Global Constraints

- This is stability-only work: repair an existing promise, truthfully constrain it, or remove it from parser/help/exports and delete the resulting dead code.
- Do not add `doctor`, a new server command, a second benchmark command, a compatibility alias, provider SDKs, or any new product surface.
- Preserve the fake-first no-key contract, zero fake cost, explicit simulation provenance, canonical output root, isolated workspaces, sealed artifact authority, disclosure sanitization, and `.olt` contents.
- Fake, simulated, dry, failed, incomplete, empty-check, invalid, or unproven records cannot produce a benchmark pass, score, rank, Elo mutation, resilience claim, regression verdict, champion, or actual cost claim.
- Live behavior remains unavailable unless construction, credential preflight, model identity, protocol envelopes, tool history, streaming usage, deadlines, retries, cancellation, lifecycle drain, evaluation, and pricing all pass deterministic fixture gates.
- Source files contain zero comments and remain strictly below 400 lines. Split any touched file already above 300 lines by responsibility before adding behavior.
- Do not add unit tests. Use comment-free deterministic integration scripts, intercepted transports, fake Docker clients, temporary output roots, strict typechecking, and the quality gate.
- One source-writing implementer works on `main` at a time. Read-only audit roles run in parallel. Each task receives fresh review, one Conventional Commit of at most 70 characters, and immediate `git push origin main`.
- Do not edit the ignored SDD ledger during implementation of this tracked plan.

---

## File and Responsibility Map

- `src/skills/registry.ts`, `src/runner/scenario-loader.ts`, `src/sweep/sweep-config-validation.ts` — package-owned catalog loading and pre-artifact selector validation.
- `src/eval/evidence-contract.ts`, `src/eval/scenario-evaluation-schema.ts` — one eligibility and evaluation authority; these files are created by Task 2 and Task 16.
- `src/reporting/schema.ts`, `src/reporting/run-store.ts`, `src/reporting/query-store.ts` — decomposed SQLite schema, writes, and reads replacing growth in the 399-line `src/reporting/db.ts`.
- `src/replay/event-session-loader.ts` — canonical event-envelope to replay-session conversion, with no sample fallback.
- `src/reporting/report-cohorts.ts` — explicit eligible, validation, and operational cohorts shared by reports and arena consumers.
- `src/cli/commands/` and `src/cli/grammar/` — decomposed command handlers and strict command specification replacing growth in the two 399-line CLI modules.
- `src/scripts/operator-contract-smoke.ts`, `src/scripts/provider-contract-smoke.ts`, `src/scripts/lifecycle-drain-smoke.ts` — deterministic integration gates, each split into focused fixture modules before reaching 300 lines.
- `.github/workflows/benchmark-matrix.yml` — operational fake-run smoke only until eligible comparable evidence exists.
- `testbed/dist/` — generated testbed output; no compiler output remains under a `src/` directory.

## Dependency Graph

```text
T1 selector admission ──> T2 eligibility ──> T4 reports ──> T5 arena/tournament ──> T6 CI
          │                    │                 │               │
          └──────────────> T3 replay ───────────┘               │
T1-T6 ──> T7 CLI delivery ──> T8 server/dashboard ──> T10 operator gate
                              T7 ──> T9 testbed ──────┘
T10 ──> T11 cancellation/permits ──> T13 provider authority ──> T14 protocol ──> T15 streams
          └────────> T12 container drain ────────────────────────────────────────┘
T2 + T5 + T11-T15 ──> T16 declared evaluation and final live-readiness gate
```

Task 3 may be implemented after Task 1 while a read-only eligibility audit supports Task 2. Task 9 may be implemented after Task 7 while read-only server/dashboard review supports Task 8. Provider fixture design and container-race auditing may run read-only during Tasks 1–10, but provider/lifecycle source changes do not merge before Task 10.

## Parallel Read-Only Audit Roles

- **Claim-surface auditor:** Tracks every pass, score, rank, Elo, winner, champion, confidence, cost, resilience, and regression phrase across CLI, artifacts, reports, replay, APIs, generated HTML, fuzzing, arena, tournament, data, and docs.
- **Operator adversary:** Repeats selector, replay, report-filter, invalid-CLI, missing-input, non-TTY, installed-binary, and output-root probes against every immutable task diff.
- **CI and delivery auditor:** Compares workflow commands with parser/help/dispatcher contracts, verifies nonempty artifacts, and audits testbed local/Docker startup without editing implementation files.
- **Provider protocol auditor:** Maintains fixture matrices for unary/streaming envelopes, tool-call history, usage, retry classification, model identity, and pricing. It never calls a live provider.
- **Lifecycle leak auditor:** Exercises queued abort, acquired permit abort, provider wait, tool wait, container-create drain, checkpoint failure, repeated release, and repeated drain against fake resources.
- **Presentation auditor:** Reviews generated report/replay/server HTML for invented values, inaccessible controls, unsafe narrow viewports, unsupported transports, and missing empty/unavailable states.

Each audit role sends exact reproductions directly to the active implementer. Reviewers do not write source, create commits, or maintain a second mutable plan.

### Task 1: Reject Unresolvable Benchmark Inputs Before Output Creation

**Priority:** P0 operator truth

**Files:**
- Modify: `src/skills/registry.ts`
- Modify: `src/runner/scenario-loader.ts`
- Modify: `src/sweep/sweep-config-validation.ts`
- Modify: `src/sweep/matrix-cell-planner.ts`
- Modify: `src/cli/commands.ts`, then move benchmark admission into `src/cli/commands/run-command.ts`
- Modify: `src/scripts/verify-scenarios.ts`

**Interfaces:**
- Consumes: CLI scenario, skill, category, model, and provider selectors plus package-owned catalog roots.
- Produces: a fully resolved immutable matrix plan; unresolved selectors produce a safe typed admission error before lease, database, checkpoint, run directory, provider, or workspace creation.
- Dependency: preserves the current runtime configuration and artifact authority.

- [ ] **Step 1: Capture the failing admission contract**

Run a no-key probe for `using-git-worktrees`, a missing skill, a missing scenario, an empty category, and a duplicate catalog ID. Record exit status and output-root inventory. The missing and ambiguous cases must currently demonstrate the false-success or late-failure behavior before implementation.

- [ ] **Step 2: Establish package-owned catalog roots**

Resolve bundled `scenarios/` from the installed package location rather than `process.cwd()`. Resolve skills through `defaultSkillRegistry`; require each requested skill to return a substantive manifest. Make the catalog verifier compare every `scenarios/catalog.json` entry with exactly one valid file and report the real count.

- [ ] **Step 3: Preflight the complete matrix**

Move selector validation before `MatrixSweepEngine.run`. Reject missing scenario, skill, category, model/provider incompatibility, duplicate catalog identity, and an empty expanded matrix. Do not create a failure record for a request that never admitted a cell.

- [ ] **Step 4: Verify repository and installed-binary behavior**

```bash
admission_root=$(mktemp -d)
env -u ANTHROPIC_API_KEY -u GEMINI_API_KEY -u GOOGLE_API_KEY -u OPENAI_API_KEY bun bin/skill-benchmarks run --mock --scenario git-worktrees --skill using-git-worktrees --model gpt-4o --output-dir "$admission_root/valid"
! rg -n 'definition not found' "$admission_root/valid"
! bun bin/skill-benchmarks run --mock --scenario git-worktrees --skill definitely-missing-skill --model gpt-4o --output-dir "$admission_root/missing"
test ! -e "$admission_root/missing/db/benchmarks.sqlite"
consumer_root=$(mktemp -d)
package_bin=$(pwd)/bin/skill-benchmarks
(cd "$consumer_root" && env SKILL_BENCHMARKS_USE_MOCK=true bun "$package_bin" run --scenario git-worktrees --skill using-git-worktrees --model gpt-4o)
```

- [ ] **Step 5: Gate, review, commit, and push**

Run `bun run typecheck`, `bun run src/scripts/quality-gate.ts`, and the exact admission probes. Commit `fix(admission): reject unresolved benchmark inputs` and push `origin main`.

### Task 2: Make Evidence Eligibility the Only Scoring Authority

**Priority:** P0 eligibility truth

**Files:**
- Create: `src/eval/evidence-contract.ts`
- Modify: `src/eval/types.ts`, `src/eval/scoring.ts`, `src/eval/deterministic.ts`, `src/eval/index.ts`
- Create: `src/reporting/schema.ts`, `src/reporting/run-store.ts`, `src/reporting/query-store.ts`
- Modify: `src/reporting/db.ts`, `src/reporting/types.ts`, `src/sweep/run-evidence.ts`
- Delete: `src/scripts/run-benchmark-trials.ts`, `data/dashboard.html`, `data/leaderboard.md`, `docs/LEADERBOARD.md`

**Interfaces:**
- Consumes: execution provenance, terminal evidence, declared/executed checks, artifact integrity, evaluator identity, and evidence digest.
- Produces: `EvidenceState`, `EvaluationOutcome`, `BenchmarkEligibility`, and explicit cohort identity. Missing scores and pass values are absent/null, never numeric zero or false observations.
- Dependency: Task 1 supplies resolved scenario and skill identities. Task 4 and Task 5 consume this contract.

```typescript
export type BenchmarkCohort = "eligible" | "validation" | "operational";
export type BenchmarkEligibilityStatus = "eligible" | "ineligible" | "unknown";
export type EvaluationOutcomeStatus = "not_requested" | "not_evaluated" | "evaluated" | "invalid";
```

- [ ] **Step 1: Prove the empty-evaluator and synthetic-claim failures**

Run `runDeterministicVerification([])` and the existing fake record generator. Record the current 100/pass/ranked outputs and every claim-bearing generated file before deleting the unhealthy paths.

- [ ] **Step 2: Decompose persistence before changing the schema**

Move schema/migrations, record writes, and queries out of the 399-line database module. Keep `TelemetryDatabase` as a small facade. Add eligibility/evaluation fields in one active-development migration; do not add a legacy converter.

- [ ] **Step 3: Enforce fail-closed evaluation invariants**

Zero declared checks becomes `not_evaluated`. Fake, simulated, dry, failed, aborted, timed-out, setup-failed, persistence-failed, cleanup-failed, incomplete, or invalid evidence is ineligible. Only complete integrity-verified evidence with executed nonempty required checks may carry score/pass.

- [ ] **Step 4: Remove synthetic benchmark producers**

Delete the randomized benchmark history script and official-looking generated leaderboard/dashboard files. Remove package exports or docs references left dead by deletion. Keep no seeding alias or golden compatibility data.

- [ ] **Step 5: Verify eligibility and absence semantics**

```bash
bun -e 'import { runDeterministicVerification } from "./src/eval/deterministic.ts"; const value = await runDeterministicVerification([], process.cwd()); if (value.allPassed || value.weightedScore !== undefined) process.exit(1)'
eligibility_root=$(mktemp -d)
bun bin/skill-benchmarks run --mock --scenario git-worktrees --skill using-git-worktrees --model gpt-4o --output-dir "$eligibility_root"
sqlite3 "$eligibility_root/db/benchmarks.sqlite" 'select execution_mode, simulated, eligibility_status, composite_score from runs;'
! rg -n 'run-benchmark-trials|Foundation Model Leaderboard|Multi-Model Golden Dashboard' src data docs package.json
```

- [ ] **Step 6: Gate, review, commit, and push**

Run both repository gates and an independent claim-surface review. Commit `fix(eval): require evidence for benchmark claims` and push `origin main`.

### Task 3: Make Replay a Lossless Persisted-Evidence Reader

**Priority:** P0 replay truth

**Files:**
- Create: `src/replay/event-session-loader.ts`
- Modify: `src/replay/replay-engine.ts`, `src/replay/types.ts`, `src/replay/index.ts`
- Modify: replay command module created under `src/cli/commands/`
- Modify: `src/server/api-router.ts`
- Modify: `src/replay/web-player.ts`, `src/replay/tui-player.ts` only where unavailable state is required

**Interfaces:**
- Consumes: current `TelemetryEvent` JSONL with `runId`, `sequenceNumber`, `timestampUs`, `type`, and nested `payload`; optional run lookup uses an existing read-only database and canonical output root.
- Produces: one loaded `ReplaySession` retained by console, JSON, TUI, and web exports. Missing or malformed evidence returns a safe unavailable/error result and never a sample.
- Dependency: Task 1 guarantees resolvable run identity; Task 2 supplies eligibility labels displayed by replay.

- [ ] **Step 1: Capture missing-target and real-event failures**

Run replay against a missing target and against a fresh fake run. Record fabricated sample identity, unknown metadata, generic tool names, and zero-frame JSON export.

- [ ] **Step 2: Parse the canonical event envelope**

Map timestamps, command/tool identity, chunks, resource samples, and terminal events from nested payloads. Preserve the loaded engine/session when exporting JSON. Reject out-of-order identity changes, malformed lines, and run ID disagreement.

- [ ] **Step 3: Remove every replay fallback**

Delete hard-coded sample construction from the CLI and server. Make `--run-id` require `--db` plus canonical output-root mapping. Return nonzero/404 for missing runs and do not create an export.

- [ ] **Step 4: Verify lossless round trip**

```bash
replay_root=$(mktemp -d)
bun bin/skill-benchmarks run --mock --scenario git-worktrees --skill using-git-worktrees --model gpt-4o --output-dir "$replay_root"
events=$(find "$replay_root/runs" -name events.jsonl -print -quit)
run_id=$(jq -r .runId "$(find "$replay_root/runs" -name result.json -print -quit)")
bun bin/skill-benchmarks replay "$events" --format json --output "$replay_root/exports/replay.json"
test "$(jq -r .metadata.runId "$replay_root/exports/replay.json")" = "$run_id"
test "$(jq '.frames | length' "$replay_root/exports/replay.json")" -gt 0
! bun bin/skill-benchmarks replay --target "$replay_root/missing.json" --format json --output "$replay_root/exports/missing.json"
test ! -e "$replay_root/exports/missing.json"
```

- [ ] **Step 5: Gate, review, commit, and push**

Run both repository gates and scan replay exports for sample/fabricated constants. Commit `fix(replay): preserve persisted run evidence` and push `origin main`.

### Task 4: Filter Reports and Remove Invented Analytics

**Priority:** P0 report truth

**Files:**
- Create: `src/reporting/report-cohorts.ts`
- Modify: `src/reporting/query-store.ts`, `src/reporting/aggregator.ts`, `src/reporting/types.ts`
- Modify: `src/reporting/html-dashboard.ts`, `src/reporting/dashboard-charts.ts`, `src/reporting/markdown-leaderboard.ts`, `src/reporting/report-card.ts`
- Modify: report command module under `src/cli/commands/`

**Interfaces:**
- Consumes: `RunQueryFilter` plus explicit `BenchmarkCohort` from Task 2.
- Produces: filtered JSON/Markdown/HTML with provider, model, mode, simulation, evaluation, eligibility, sample count, and availability provenance. Default leaderboard input is eligible-only.
- Dependency: Task 2 eligibility is mandatory. Task 3 supplies truthful replay links only when evidence exists.

- [ ] **Step 1: Record false filter and chart outputs**

Run three nonexistent filters against a one-row database and capture the current returned row, `DEFAULT` model, rank, Elo, fixed token velocity, and fixed percentile values.

- [ ] **Step 2: Apply filters at query time**

Thread category, skill, model, provider, execution mode, simulation, eligibility, and terminal status into `queryRuns`. Require each report caller to select one cohort; reject mixed cohorts.

- [ ] **Step 3: Remove invented metrics and rankings**

Delete constant percentiles, token velocity, default model labels, empty-series scores, and top-ranked language without eligible input. Render `UNAVAILABLE`, `UNEVALUATED`, `SIMULATED / UNRANKED`, or an empty state from stored facts.

- [ ] **Step 4: Verify all report formats**

```bash
report_root=$(mktemp -d)
bun bin/skill-benchmarks run --mock --scenario git-worktrees --skill using-git-worktrees --model gpt-4o --output-dir "$report_root"
bun bin/skill-benchmarks report --db "$report_root/db/benchmarks.sqlite" --format json --category definitely-missing --output "$report_root/exports/empty.json"
test "$(jq '.runCount' "$report_root/exports/empty.json")" -eq 0
test "$(jq '.leaderboard | length' "$report_root/exports/empty.json")" -eq 0
bun bin/skill-benchmarks report --db "$report_root/db/benchmarks.sqlite" --format html --output "$report_root/exports/report.html"
rg -n 'SIMULATED|UNEVALUATED|gpt-4o' "$report_root/exports/report.html"
! rg -n '210 ms|680 ms|1320 ms|TOP RANKED SKILL|DEFAULT' "$report_root/exports/report.html"
```

- [ ] **Step 5: Gate, review, commit, and push**

Run both repository gates plus report canary, no-ANSI JSON, and missing-database probes. Commit `fix(reporting): publish evidence-backed cohorts` and push `origin main`.

### Task 5: Constrain Arena, Tournament, and Fuzz Claims

**Priority:** P0 arena and tournament truth

**Files:**
- Modify: `src/cli/arena-command.ts`, tournament and fuzz command modules under `src/cli/commands/`
- Modify: `src/runner/arena-runner.ts`, `src/runner/tournament-scheduler.ts`
- Modify: `src/arena/consensus-scorer.ts`, `src/arena/types.ts`
- Modify: `src/eval/pairwise-elo.ts`
- Delete: `src/fuzzer/` and its exports when no common runner/evaluator path exists

**Interfaces:**
- Consumes: resolved runtime config, isolated workspace, candidate terminal/evidence status, judge evidence status, and eligibility contract.
- Produces: dry-run pairings only; fake/simulated executions are visibly unranked; winner, confidence, bias, Elo, standings, and champion are absent unless both candidates and judge evidence are eligible and comparable.
- Dependency: Tasks 1 and 2. Full live eligibility remains blocked until Task 16.

- [ ] **Step 1: Capture false arena/tournament/fuzz claims**

Run normal no-key arena, dry arena, dry tournament, and one fuzz mutation. Record successful tool-error trials, fake tie/confidence, Elo/champion text, pass/resilience, and synthetic cost.

- [ ] **Step 2: Route one runtime authority and workspace contract**

Resolve mode/output/provider before candidate or judge construction. Supply each candidate the existing disposable workspace. Treat failed tools, incomplete candidates, malformed judge output, fake judges, and noncomparable policies as unevaluated.

- [ ] **Step 3: Remove unsupported claim producers**

Make dry arena/tournament output pairings and capacity only. Make fake executions `SIMULATED / UNRANKED` without judge or Elo mutation. If fuzz cannot invoke the common runner and evaluator now, remove its command, help, types, exports, and source rather than retaining a simulation under the benchmark name.

- [ ] **Step 4: Verify claim suppression**

```bash
claim_root=$(mktemp -d)
bun bin/skill-benchmarks arena --dry-run --arena gpt-4o,claude-3-7-sonnet-20250219 --output-dir "$claim_root" | rg 'planned pairing'
! bun bin/skill-benchmarks arena --dry-run --arena gpt-4o,claude-3-7-sonnet-20250219 --output-dir "$claim_root" | rg 'winner|confidence|Elo|CLEAN'
bun bin/skill-benchmarks tournament --dry-run --model gpt-4o,claude-3-7-sonnet-20250219 --output "$claim_root/tournament.json"
rg -n 'SIMULATED|UNRANKED' "$claim_root/tournament.json"
! rg -n 'CHAMPION|elo.*[1-9]|winner' "$claim_root/tournament.json"
! bun bin/skill-benchmarks fuzz --scenario git-worktrees
```

- [ ] **Step 5: Gate, review, commit, and push**

Run both repository gates and the claim-surface auditor. Commit `fix(arena): suppress unproven ranking claims` and push `origin main`.

### Task 6: Replace the Green No-Op CI Workflow

**Priority:** P0 CI truth

**Files:**
- Modify: `.github/workflows/benchmark-matrix.yml`
- Delete: unused `src/ci/` modules if the empty regression/comment path has no truthful consumer
- Modify: `package.json`
- Modify: narrow CI documentation under `README.md` and `docs/usage-guide/`

**Interfaces:**
- Consumes: exact package CLI grammar and canonical fake output root.
- Produces: a nonempty operational smoke artifact containing the canonical database, run evidence, sweep plan/checkpoint/outcome, and logs. It produces no regression or leaderboard verdict.
- Dependency: Tasks 1, 2, 4, and 5.

- [ ] **Step 1: Preserve the exact false-green reproduction**

Run the workflow command in a clean temporary directory and prove it exits zero with no database. Record invalid categories, unsupported flags, empty comparison arrays, and unpinned Bun.

- [ ] **Step 2: Use only supported operational commands**

Pin Bun to `1.3.14`, run frozen install and both gates, invoke `bin/skill-benchmarks run --mock` with valid catalog entries and `--output-dir`, then assert nonempty SQLite/run/outcome evidence before upload.

- [ ] **Step 3: Remove vacuous regression and comment behavior**

Delete the empty-array regression decision and PR leaderboard comment until eligible comparable cohorts exist. Remove its now-dead exports/source rather than keeping a dormant compatibility subsystem.

- [ ] **Step 4: Verify the workflow command locally**

```bash
ci_root=$(mktemp -d)
env SKILL_BENCHMARKS_USE_MOCK=true bun bin/skill-benchmarks run --category coding --skill using-git-worktrees --model gpt-4o --output-dir "$ci_root/candidate"
test "$(sqlite3 "$ci_root/candidate/db/benchmarks.sqlite" 'select count(*) from runs;')" -gt 0
test "$(sqlite3 "$ci_root/candidate/db/benchmarks.sqlite" 'select count(*) from runs where execution_mode="fake" and simulated=1 and eligibility_status!="eligible";')" -gt 0
test -s "$(find "$ci_root/candidate/sweeps" -name outcome.json -print -quit)"
```

- [ ] **Step 5: Gate, review, commit, and push**

Run a workflow syntax check, both repository gates, and an independent exact-command audit. Commit `fix(ci): run a nonempty benchmark smoke` and push `origin main`.

### Task 7: Make the Installed CLI Grammar and Output Strict

**Priority:** P1 CLI delivery

**Files:**
- Create: `src/cli/grammar/{types,specification,validation,help}.ts`
- Create: `src/cli/commands/{run,report,replay,arena,tournament,list}.ts`
- Modify or replace: `src/cli/parser.ts`, `src/cli/commands.ts`, `src/cli/index.ts`, `src/cli/types.ts`, `src/cli/formatter.ts`
- Modify: `package.json`
- Remove: inert public sync command handler/types/help; retain `package.json` `sync:skills` only if its script is truthful

**Interfaces:**
- Consumes: one command specification shared by parse, validation, dispatch, and help.
- Produces: nonzero unknown/invalid input, command-specific help, allowlisted safe diagnostic codes, exact output formats, TTY-aware color, `NO_COLOR` support, and a truthful package `test` command that does not invoke an empty unit-test runner.
- Dependency: Tasks 1–6 define the remaining supported command surface.

- [ ] **Step 1: Decompose the two 399-line CLI modules**

Record that `bun run test` exits nonzero only because the repository intentionally contains no unit tests. Replace it with `bun run typecheck` as the truthful static verification command until Task 10 promotes it to the operator integration gate. Move command handlers and grammar ownership into the listed focused files before adding validation. Delete wrapper branches that preserve ignored flags or removed commands.

- [ ] **Step 2: Enforce command/flag contracts**

Reject unknown commands, flags, subcommands, unexpected positionals, missing values, invalid numbers/enums, contradictory duplicates, and unsupported command/flag combinations before execution. Either implement an advertised output for its existing command or remove that option from types/help.

- [ ] **Step 3: Make output deterministic for humans and machines**

Make JSON exactly one JSON document with diagnostics on stderr. Disable ANSI when stdout is not a TTY and whenever `NO_COLOR` is present. Keep raw provider exceptions and filesystem paths outside public diagnostics while exposing allowlisted resolution codes.

- [ ] **Step 4: Verify strict grammar and packaging**

```bash
! bun bin/skill-benchmarks rn
! bun bin/skill-benchmarks list nonsense
! bun bin/skill-benchmarks list scenarios --definitely-unknown
! bun bin/skill-benchmarks run --concurrency banana
bun bin/skill-benchmarks replay --help | rg 'target|run-id|format|output|db'
NO_COLOR=1 bun bin/skill-benchmarks list scenarios > /tmp/skill-bench-list.txt
! rg $'\x1b\[' /tmp/skill-bench-list.txt
bun run test
```

- [ ] **Step 5: Gate, review, commit, and push**

Run both repository gates and the installed-binary probe from outside the checkout. Commit `fix(cli): enforce the published command grammar` and push `origin main`.

### Task 8: Consolidate the Local Server and Dashboard on Truthful Readers

**Priority:** P1/P2 operator delivery and visual truth

**Files:**
- Modify: `src/server/http-server.ts`, `src/server/api-router.ts`, `src/server/types.ts`
- Modify: `src/reporting/html-dashboard.ts`, `src/reporting/dashboard-charts.ts`
- Delete: `src/dashboard-ui/` and its `src/index.ts` export if it remains a second unused rendering stack
- Modify: `src/replay/web-player.ts`

**Interfaces:**
- Consumes: read-only existing database, Task 3 replay loader, Task 4 report cohorts, and disclosure-converted records.
- Produces: loopback-only, read-only-by-default routes; missing evidence is 404/unavailable; generated controls are accessible and narrow-viewport safe.
- Dependency: Tasks 3, 4, and 7.

- [ ] **Step 1: Reproduce fabricated and unsafe server behavior**

Record wildcard CORS, remote default bind, unknown-run telemetry ingestion, missing replay 200, invented CPU/RSS, raw exception text, duplicate dashboard fallback values, and unsupported WebSocket endpoint.

- [ ] **Step 2: Remove unsafe writes and fabricated states**

Default to loopback, remove wildcard CORS, return 404 for missing replay, remove invented telemetry, and reject unknown-run writes. Delete the write route if it cannot authenticate/validate within the existing local contract. Delete the unused dashboard stack and unsupported client endpoint rather than wiring a new transport.

- [ ] **Step 3: Repair existing generated HTML semantics**

Add accessible names, keyboard-sort buttons with `aria-sort`, chart title/description text, visible empty/result-count states, focus indicators, and a layout without page overflow at 390 pixels. Derive all values from Task 4 cohorts.

- [ ] **Step 4: Verify server and visual contracts**

Run an ephemeral loopback server probe for bind, CORS, 404, and write rejection. Render a generated report at 1440x900, 768x1024, and 390x844; store screenshots outside source. Keyboard-tab all controls and verify no horizontal page overflow.

- [ ] **Step 5: Gate, review, commit, and push**

Run both repository gates, server probe, semantic scan, and presentation review. Commit `fix(server): remove fabricated dashboard state` and push `origin main`.

### Task 9: Make the Testbed Build, Start, and Containerize Cleanly

**Priority:** P1 delivery

**Files:**
- Modify: `testbed/package.json`, `testbed/frontend/package.json`, `testbed/backend/package.json`
- Modify: `testbed/frontend/tsconfig.json`, `testbed/backend/tsconfig.json`
- Create: `testbed/scripts/start.ts`, `testbed/frontend/index.html`
- Modify: `testbed/backend/src/server.ts`, `testbed/frontend/src/index.tsx`
- Modify: `testbed/Dockerfile`, `testbed/README.md`
- Add: one testbed-owned lockfile selected by the repository package policy

**Interfaces:**
- Consumes: frozen testbed dependencies and existing frontend/backend/Go services.
- Produces: build output under `testbed/dist`, a bounded native supervisor, documented health paths, non-root runtime image, and exact shutdown of every child.
- Dependency: Task 7 fixes the package delivery/version contract. The testbed remains a benchmark target, not benchmark evidence.

- [ ] **Step 1: Record current start/build pollution**

Capture the missing `concurrently`, absent frontend start, nonbinding backend, source-emitted JavaScript, and Dockerfile dependency/start failures with a clean Git status before and after.

- [ ] **Step 2: Establish one locked build**

Declare every executed dependency, use `bun install --frozen-lockfile`, emit frontend/backend output only beneath `testbed/dist`, build the Go binary, and keep source clean.

- [ ] **Step 3: Start and stop declared services**

Use a small Bun supervisor instead of an undeclared global runner. Start the built frontend, backend, and microservice; wait for existing health/nonmutating routes; forward shutdown; and report nonzero when a child fails.

- [ ] **Step 4: Align the Docker image**

Install locked dependencies, build all services, copy only runtime artifacts, run as non-root, expose documented ports, start all declared services, and stop cleanly.

- [ ] **Step 5: Verify delivery without source pollution**

```bash
before=$(git status --porcelain)
bun install --cwd testbed --frozen-lockfile
bun run --cwd testbed typecheck
bun run --cwd testbed build
after=$(git status --porcelain)
test "$before" = "$after"
go test ./...
docker build -t skill-benchmarks-testbed:local testbed
```

Run the Go command from `testbed/microservice`. Run a bounded local and container start probe that checks all declared health paths and terminates exact processes.

- [ ] **Step 6: Gate, review, commit, and push**

Run both repository gates plus local/container testbed checks. Commit `fix(testbed): make local delivery reproducible` and push `origin main`.

### Task 10: Distribute Operator Verification and Align Documentation

**Priority:** P1 delivery gate

**Files:**
- Create: `src/scripts/operator-contract-smoke.ts` and focused fixtures under `src/scripts/operator-contract/`
- Modify: `src/scripts/quality-gate.ts`, `src/scripts/verify-scenarios.ts`, `package.json`
- Modify: `README.md`, `docs/usage-guide/`, `.github/workflows/benchmark-matrix.yml`

**Interfaces:**
- Consumes: Tasks 1–9 public contracts.
- Produces: named static, catalog, fake-run, CLI, artifact, replay, report, server, testbed, Docker, and workflow gates. The package `test` script points to this deterministic integration gate; it never invokes an empty unit-test runner or becomes an absent public command.
- Dependency: Tasks 1–9.

- [ ] **Step 1: Expand the static boundary**

Scan maintained source roots `src`, `bin`, `testbed`, and `docker`; exclude dependencies/generated output. Enforce strict sub-400 lines and zero comments for TypeScript, TSX, JavaScript, shell, Go, and Dockerfile source while allowing only required language directives.

- [ ] **Step 2: Add deterministic operator smoke cases**

Create separate cases for selector admission, no-key fake run, artifact reconciliation, invalid CLI, piped output, replay round trip, report filters/cohorts, local server, testbed local start, Docker start, and exact workflow command. Every case uses its own temporary root and asserts checkout cleanliness. Set `package.json` `test` to run `bun run typecheck` followed by `bun run src/scripts/operator-contract-smoke.ts` so the conventional public command performs maintained verification without introducing unit tests.

- [ ] **Step 3: Publish only implemented instructions**

Rewrite quickstart, CLI reference, report/replay guidance, testbed guide, and CI notes from the verified commands. Keep arena/tournament explicitly simulated/unranked until Task 16. Do not document removed sync/fuzz/server command surfaces.

- [ ] **Step 4: Run the complete operator gate**

```bash
bun run typecheck
bun run src/scripts/quality-gate.ts
bun run src/scripts/operator-contract-smoke.ts
bun run --cwd testbed typecheck
(cd testbed/microservice && go test ./...)
```

- [ ] **Step 5: Review, commit, and push**

Require independent CLI, CI, and presentation audits. Commit `chore(verify): add operator delivery gates` and push `origin main`.

### Task 11: Enforce Deadlines, Retries, Abort, and Permit Finalization

**Priority:** P1 runtime lifecycle

**Files:**
- Create: `src/shared/cancellation.ts`, `src/shared/provider-turn-permit.ts`
- Create: `src/providers/transport/{types,retry-policy,request-executor}.ts`
- Modify: `src/providers/anthropic.ts`, `src/providers/openai.ts`, `src/providers/gemini.ts`
- Modify: `src/runner/runner-engine.ts`, `src/runner/types.ts`
- Modify: `src/sweep/token-bucket.ts`, `src/sweep/cell-execution.ts`, `src/sweep/sweep-engine.ts`

**Interfaces:**
- Consumes: sweep abort signal, scenario remaining time, turn deadline, provider timeout, retry classification, and limiter capacity.
- Produces: one composed signal per attempt, bounded total deadline, typed timeout/abort/provider failures, and an idempotent permit released exactly once from `finally`.
- Dependency: Task 10 freezes public delivery behavior before lifecycle internals change.

```typescript
export interface ProviderTurnPermit {
  release(outcome: "completed" | "rate_limited" | "failed" | "aborted", actualTokens?: number, retryAfterMs?: number): Promise<void>;
}
```

- [ ] **Step 1: Capture inert timeout/retry and permit leaks**

Use intercepted fetch and a blocking fake provider to reproduce one fetch despite `maxRetries`, timeout overrun, scenario success after deadline, abort not reaching generation, and nonzero active permits after terminal failure.

- [ ] **Step 2: Decompose near-limit runtime files**

Move provider transport/retry work out of adapters and cell lifecycle work out of the 383/391-line sweep modules before threading signals.

- [ ] **Step 3: Compose cancellation and retry**

Caller abort wins. Each attempt receives a fresh provider timeout bounded by remaining scenario/turn time. Retry only classified transient failures, honor bounded Retry-After, and never schedule after abort/deadline.

- [ ] **Step 4: Return exactly-once rate permits**

Make limiter acquisition abort-aware and return a permit. Release it in `finally` for success, rate limit, provider error, retry exhaustion, setup failure, or abort. Remove manual accounting APIs that callers can omit.

- [ ] **Step 5: Verify deterministic runtime cases**

Run no-network cases for retryable then success, authentication no-retry, provider timeout, scenario timeout, caller abort, abort while rate queued, and abort after permit. Assert expected attempts, terminal reasons, and zero active permits.

- [ ] **Step 6: Gate, review, commit, and push**

Run both repository gates and lifecycle leak review. Commit `fix(runtime): enforce cancellation and retry limits` and push `origin main`.

### Task 12: Make Container Drain a Terminal Barrier

**Priority:** P0/P1 lifecycle drain

**Files:**
- Modify: `src/infrastructure/container/types.ts`, `src/infrastructure/container/pool.ts`, `src/infrastructure/container/instance.ts`
- Create: `src/infrastructure/container/creation-lease.ts`
- Create: `src/scripts/lifecycle-drain-smoke.ts` and fixtures under `src/scripts/lifecycle-drain/`

**Interfaces:**
- Consumes: `AbortSignal` and fake/real Docker creation lifecycle.
- Produces: creation leases that own volume/container identity from the first side effect, refuse publication after drain, memoize teardown, and let `drain()` resolve only at zero queued, pending, active, container, and volume counts.
- Dependency: Task 11 cancellation semantics.

- [ ] **Step 1: Preserve the drain-during-create failure**

Use a deferred fake Docker client to show the current drain returns before creation publishes a late active container with no cleanup.

- [ ] **Step 2: Replace placeholders with creation leases**

Track queued acquisition, volume, container ID, start, publication, cancellation, and one teardown promise. Reject new/queued work on drain, await pending creation, and tear down anything that completes after drain starts.

- [ ] **Step 3: Make release and drain idempotent**

Converge release/drain on the same teardown promise. Preserve the first teardown failure in a safe aggregate status while continuing all cleanup.

- [ ] **Step 4: Run the lifecycle smoke matrix**

Execute `drain-during-container-create`, cancellation before create, failure after volume, failure after container, repeated release, and repeated drain with fake Docker. Assert exact cleanup counts and zero residual resources.

- [ ] **Step 5: Gate, review, commit, and push**

Run both repository gates and lifecycle auditor. Commit `fix(container): make drain a terminal barrier` and push `origin main`.

### Task 13: Unify Provider Construction, Models, and Pricing

**Priority:** P1/P2 provider authority

**Files:**
- Modify: `src/providers/factory.ts`, `src/providers/index.ts`, `src/providers/types.ts`, `src/providers/pricing.ts`
- Modify: `src/models/canonical-models.ts`, `src/models/model-registry.ts`, `src/models/types.ts`
- Modify: `src/sweep/types.ts`, `src/sweep/cell-execution.ts`
- Modify: arena/tournament defaults in their command modules

**Interfaces:**
- Consumes: explicit resolved execution mode, provider, exact model ID, credential, and canonical rate card.
- Produces: one public factory; immutable live/fake provenance; exact model/provider/rate resolution; unknown live models fail closed; fake fixture labels do not mutate the live registry.
- Dependency: Task 11 transport executor and Task 2 eligibility.

- [ ] **Step 1: Capture construction and pricing divergence**

Without keys, compare factory preflight with direct helpers. Compare every canonical model rate against provider pricing and record unsafe alias/prefix/fallback results.

- [ ] **Step 2: Remove duplicate construction and dead injection**

Delete public helper constructors that bypass resolved mode. Remove `ModelMatrixEntry.provider` and its ignored assertion; keep fixture injection only in an internal smoke dependency object.

- [ ] **Step 3: Establish one canonical model/rate authority**

Derive cost from exact canonical entries. Remove provider-agnostic fallback and prefix matching. Canonicalize built-in defaults; reject unknown live IDs while allowing explicit fake labels without registry mutation.

- [ ] **Step 4: Verify all models and no-key preflight**

Run a parity script across canonical/default models, factory fake construction for Anthropic/OpenAI/Google, missing-key live preflight, and unknown-live rejection. Assert fake remains zero-cost.

- [ ] **Step 5: Gate, review, commit, and push**

Run both repository gates and provider authority review. Commit `fix(providers): unify model and pricing authority` and push `origin main`.

### Task 14: Preserve Tool History and Validate Unary Envelopes

**Priority:** P1 provider protocol

**Files:**
- Create: `src/providers/protocol/{types,anthropic-messages,openai-chat,gemini-content}.ts`
- Modify: `src/providers/anthropic.ts`, `src/providers/openai.ts`, `src/providers/gemini.ts`, `src/providers/types.ts`
- Modify: `src/runner/context-manager.ts`
- Create: provider smoke fixtures under `src/scripts/provider-contract/`

**Interfaces:**
- Consumes: canonical `AgentMessage` assistant tool calls and tool results with both call ID and declared function name.
- Produces: exact provider wire history and validated normalized turns. Orphan results, malformed arguments, missing terminal identity, contradictory finish state, and empty HTTP 200 envelopes are typed protocol errors.
- Dependency: Tasks 11 and 13.

- [ ] **Step 1: Capture second-turn wire bodies and empty-envelope success**

Intercept all three unary transports after two canonical tool turns. Record missing Anthropic/Gemini tool blocks and each provider accepting `{}` as an empty successful stop.

- [ ] **Step 2: Centralize provider protocol mapping**

Preserve assistant call ID/name/arguments and tool result ID/name/content for every provider. Validate correspondence before dispatch and reject malformed/orphan history without a request.

- [ ] **Step 3: Validate response envelopes before normalization**

Require provider response identity, content/candidate shape, explicit finish state, and usage. Map explicit filtering/block states to `content_filter`; reject absent or contradictory terminal state.

- [ ] **Step 4: Verify two-turn protocol parity**

Run intercepted fixtures for text stop, tool call, tool result continuation, content filter, malformed arguments, orphan result, empty 200, and contradictory finish state across all three providers.

- [ ] **Step 5: Gate, review, commit, and push**

Run both repository gates and protocol auditor. Commit `fix(providers): preserve validated tool history` and push `origin main`.

### Task 15: Make Streaming Equivalent to Unary Turns

**Priority:** P1 streaming and accounting

**Files:**
- Create: `src/providers/stream/{decoder,anthropic-stream,openai-stream,gemini-stream}.ts`
- Modify: `src/providers/anthropic.ts`, `src/providers/openai.ts`, `src/providers/gemini.ts`
- Modify: `src/providers/types.ts`, `src/runner/runner-engine.ts`
- Extend: `src/scripts/provider-contract-smoke.ts`

**Interfaces:**
- Consumes: provider SSE/stream events and the same normalized-turn contract as Task 14.
- Produces: text, reasoning, tool deltas, finish reason, terminal usage, EOF flush, and cost equivalent to the unary fixture. Malformed terminal stream state is an error.
- Dependency: Task 14 defines valid normalized turns.

- [ ] **Step 1: Capture current stream data loss**

Replay fixtures containing terminal usage and tool calls through all adapters. Record OpenAI zero usage, Anthropic lost tool/usage, Gemini lost function/usage, malformed-event suppression, and lost final unterminated buffer.

- [ ] **Step 2: Split protocol-complete decoders from adapters**

Implement bounded decoder/final-buffer handling and provider-specific event state machines in focused modules. Flush decoder and buffer at EOF. Reject invalid event order or missing terminal requirements.

- [ ] **Step 3: Normalize complete streamed turns**

Emit text/reasoning/tool deltas for interactivity and one terminal usage/finish state for accounting. Ensure runner streaming selection cannot change correctness, tool dispatch, token totals, or cost.

- [ ] **Step 4: Verify unary/stream equality**

For each provider, feed equivalent unary and streaming fixtures and deep-compare normalized text, tools, finish reason, usage, reasoning tokens, and calculated cost. Include chunk-split UTF-8, final buffer without newline, content filter, and malformed terminal cases.

- [ ] **Step 5: Gate, review, commit, and push**

Run both repository gates and provider protocol review. Commit `fix(providers): make streams protocol complete` and push `origin main`.

### Task 16: Execute Declared Evaluation and Close the Readiness Gate

**Priority:** Final cross-system stability gate

**Files:**
- Create: `src/eval/scenario-evaluation-schema.ts`, `src/eval/evidence-digest.ts`
- Modify: `src/runner/scenario-loader.ts`, `src/sweep/cell-execution.ts`, `src/sweep/run-evidence.ts`
- Modify: `src/eval/deterministic.ts`, `src/eval/scoring.ts`
- Modify: arena/tournament consumers from Task 5
- Extend: operator, provider, and lifecycle smoke scripts
- Modify: implemented readiness wording in `README.md` and `docs/usage-guide/`

**Interfaces:**
- Consumes: Task 2 evidence contract, Task 11 cancellation/permits, Task 12 terminal drain, Task 13 model/pricing authority, and Tasks 14–15 protocol-complete turns.
- Produces: validated declared evaluator execution inside the exact isolated workspace, durable `evaluation.json`, digest/version trace, and eligibility only after terminal resource and artifact integrity gates. Arena/tournament automatically remain unranked unless the same contract is satisfied.
- Dependency: Tasks 2, 5, and 11–15.

- [ ] **Step 1: Classify every scenario evaluation declaration**

The read-only scenario auditor produces a complete table of valid nonempty checks, invalid declarations, and explicit no-evaluation scenarios. Reject ambiguous declarations at catalog admission; do not infer checks.

- [ ] **Step 2: Execute validators before workspace disposal**

After successful runner execution and before final cleanup, run declared deterministic validators in the exact workspace with cancellation. Sanitize evidence, compute digest/version, write `evaluation.json` atomically, and persist eligibility only after artifact integrity and lifecycle finalization agree.

- [ ] **Step 3: Gate all final consumers**

Require matching eligible candidate evidence before score/pass, arena winner, tournament standings, Elo mutation, report ranking, or any future regression decision. Empty or insufficient cohorts return `NOT_EVALUATED`/unranked, never green.

- [ ] **Step 4: Run the complete no-key readiness suite**

```bash
bun run typecheck
bun run src/scripts/quality-gate.ts
bun run src/scripts/operator-contract-smoke.ts
bun run src/scripts/provider-contract-smoke.ts
bun run src/scripts/lifecycle-drain-smoke.ts
```

The suite proves all three fake provider IDs use no network and remain zero-cost/ineligible, all missing live credentials fail before resource acquisition, two tool turns and unary/stream responses normalize identically, all abort/drain cases leave zero resources, and only the designated local evaluator fixture can become eligible.

- [ ] **Step 5: Run final independent reviews**

Run claim-surface, operator, CI/delivery, provider protocol, lifecycle leak, and presentation audits against the same commit. Repair every scoped High/Medium finding and rerun the owning audit.

- [ ] **Step 6: Commit and push**

Commit `fix(eval): admit only complete benchmark evidence` and push `origin main` after all gates and reviews pass.

## Plan Self-Review

- **Spec coverage:** Task 1 closes selector/package admission. Tasks 2–6 close eligibility, replay, report, arena/tournament, and CI P0 truth. Tasks 7–10 close strict CLI, local server/dashboard, testbed, docs, and verification delivery. Tasks 11–15 close cancellation, permits, drain, provider authority, tool history, unary validation, streaming, model identity, and pricing. Task 16 closes evaluator execution and final consumer eligibility.
- **Audit reconciliation:** The audits predate foundation-sealing commits. This plan does not reopen already-repaired lease debris, plan/evidence atomicity, database/report missing-path refusal, event/raw canonical authority, split-Basic redaction, safe CLI exception formatting, or fake provenance contracts. Their regression probes remain in the operator gate.
- **Removal decisions:** Synthetic benchmark history is deleted. Fuzz is deleted if it cannot use the common runner/evaluator. The inert public sync command is removed while its separate real maintenance script may remain. Empty CI regression/comment code and the duplicate dashboard stack are deleted when no truthful consumer remains.
- **Dependency check:** Reports cannot precede eligibility. Arena/tournament claims cannot precede eligibility. CI cannot claim regression. Provider/lifecycle implementation follows operator delivery. Declared evaluation and live eligibility wait for cancellation, drain, provider protocol, streaming, model, and pricing gates.
- **Constraint check:** No task adds a product surface, unit-test suite, compatibility shim, source comments, or a source file at or above 400 lines. `.olt` and the ignored SDD ledger remain untouched.
- **Placeholder scan:** Every task names exact files, interfaces, failure behavior, deterministic verification, review, commit, and push boundaries.

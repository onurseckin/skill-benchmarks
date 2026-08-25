# Trustworthy Offline Benchmark Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a normal benchmark invocation run in deterministic fake mode by default, never mutate the repository checkout, and persist explicit execution provenance.

**Architecture:** A small shared configuration resolver becomes the sole authority for fake versus live mode, credential validation, and the output root. The sweep creates a run-local workspace and artifact layout before constructing the provider, passes only that workspace to tool execution, and saves mode-aware results through the existing telemetry database.

**Tech Stack:** Bun, TypeScript strict mode, Bun SQLite, Node filesystem APIs, Docker-compatible container interfaces.

**Spec:** `docs/superpowers/specs/2026-08-25-benchmark-reliability-program-design.md`

## Global Constraints

- Fake mode is the default; `SKILL_BENCHMARKS_USE_MOCK` accepts only `true` or `false`, and `--mock` and `--live` are mutually exclusive.
- Live mode must fail before any provider request when the selected provider has no nonblank credential.
- Fake tools receive a disposable workspace and a scrubbed environment; no benchmark tool call may use the repository checkout as a fallback.
- Every run and database record exposes `executionMode` and `simulated`; fake cost is zero.
- Runtime artifacts use `.benchmarks` by default and remain outside committed source data; `.olt` is untouched.
- Source files contain no comments and remain strictly below 400 lines.
- Do not add unit tests. Verify with `bun run typecheck`, `bun run src/scripts/quality-gate.ts`, and deterministic CLI smoke commands.
- Each completed task must be committed with a Conventional Commit and pushed to `origin main` after verification.

---

## File Structure

- Create: `src/shared/execution-mode.ts` — strict fake/live parsing and execution-mode types.
- Create: `src/shared/benchmark-runtime-config.ts` — resolved configuration, output paths, and credential preflight.
- Create: `src/shared/index.ts` — public shared-runtime exports.
- Create: `src/infrastructure/workspace/run-artifact-layout.ts` — canonical output-root and per-run artifact paths.
- Create: `src/infrastructure/workspace/disposable-workspace.ts` — fake-mode workspace lifecycle outside the checkout.
- Modify: `src/infrastructure/workspace/types.ts` — artifact and disposable-workspace contracts.
- Modify: `src/infrastructure/workspace/index.ts` — workspace runtime exports.
- Modify: `src/providers/types.ts` — provider construction receives resolved mode information.
- Modify: `src/providers/factory.ts` — explicit fake/live adapter selection and credential preflight.
- Modify: `src/providers/mock-adapter.ts` — deterministic valid tool trajectory and zero fake cost.
- Modify: `src/runner/types.ts` — result provenance fields.
- Modify: `src/runner/runner-engine.ts` — preserve actual mode and simulated status in results.
- Modify: `src/runner/tool-handlers.ts` — require a supplied workspace and construct a scrubbed command environment.
- Modify: `src/sweep/types.ts` — sweep runtime configuration and cell provenance.
- Modify: `src/sweep/sweep-engine.ts` — create/tear down disposable workspaces, canonical artifacts, and fake-aware run records.
- Modify: `src/cli/types.ts` — expose execution-mode and output-root CLI options.
- Modify: `src/cli/parser.ts` — parse `--output-dir`, validate mutually exclusive mode flags, and preserve unset booleans.
- Modify: `src/cli/commands.ts` — resolve runtime configuration once and pass it to the sweep.
- Modify: `src/reporting/types.ts` — persist execution provenance in manifests and records.
- Modify: `src/reporting/db.ts` — add compatible provenance columns and map them both directions.
- Modify: `.gitignore` — ignore `.benchmarks/` runtime output.
- Modify: `README.md` and `docs/usage-guide/getting-started/configuration.md` — document only the implemented fake/live and output-root behavior.

### Task 1: Introduce the Runtime Configuration Contract

**Files:**
- Create: `src/shared/execution-mode.ts`
- Create: `src/shared/benchmark-runtime-config.ts`
- Create: `src/shared/index.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/parser.ts`
- Modify: `src/cli/commands.ts`

**Interfaces:**
- Produces: `ExecutionMode`, `BenchmarkRuntimeConfig`, `resolveBenchmarkRuntimeConfig`, and `BenchmarkRuntimeConfigInput`.
- Consumes: CLI raw values and `process.env` without loading a `.env` file.
- Required shape:

```typescript
export type ExecutionMode = "fake" | "live";

export interface BenchmarkRuntimeConfig {
  readonly executionMode: ExecutionMode;
  readonly outputRoot: string;
  readonly requestedProviderId?: ProviderId;
}

export function resolveBenchmarkRuntimeConfig(
  input: BenchmarkRuntimeConfigInput,
  environment: NodeJS.ProcessEnv = process.env
): BenchmarkRuntimeConfig;
```

- [ ] **Step 1: Add strict execution-mode parsing**

Create `src/shared/execution-mode.ts`. Parse the only valid environment literals as `true` and `false`; reject any nonempty alternative with an argument error naming `SKILL_BENCHMARKS_USE_MOCK`. Resolve no flags and no environment value to `fake`. Resolve `--mock` to `fake`, `--live` to `live`, and reject both flags together.

- [ ] **Step 2: Add the resolved runtime configuration**

Create `src/shared/benchmark-runtime-config.ts`. Resolve `--output-dir`, then `SKILL_BENCHMARKS_OUTPUT_DIR`, then `<cwd>/.benchmarks` through `resolve`. Reject empty output roots and resolve the requested provider only when the CLI supplied one. Export all public contracts through `src/shared/index.ts`.

- [ ] **Step 3: Thread mode inputs through the CLI contract**

Add optional `mock`, `live`, and `outputDir` fields to the benchmark command options. Add `outputDir` to the parser flag specification with aliases `output-dir` and `outputDir`. Preserve an absent boolean as `undefined` so the resolver can distinguish unset from false. In `runBenchmarkCommand`, resolve runtime configuration once and pass it to the sweep configuration.

- [ ] **Step 4: Run deterministic configuration probes**

Run these probes from the repository root. They must emit `fake`, `live`, and an explicit invalid-value failure without a provider request:

```bash
bun -e 'import { resolveBenchmarkRuntimeConfig } from "./src/shared/index.ts"; console.log(resolveBenchmarkRuntimeConfig({}, {}).executionMode)'
bun -e 'import { resolveBenchmarkRuntimeConfig } from "./src/shared/index.ts"; console.log(resolveBenchmarkRuntimeConfig({ live: true }, {}).executionMode)'
SKILL_BENCHMARKS_USE_MOCK=invalid bun -e 'import { resolveBenchmarkRuntimeConfig } from "./src/shared/index.ts"; resolveBenchmarkRuntimeConfig({}, process.env)'
```

- [ ] **Step 5: Verify and commit the task**

Run `bun run typecheck` and `bun run src/scripts/quality-gate.ts`. Review the task diff, commit it as `feat(config): add explicit benchmark runtime mode`, and push the commit to `origin main`.

### Task 2: Create a Disposable Workspace and Canonical Artifact Layout

**Files:**
- Create: `src/infrastructure/workspace/run-artifact-layout.ts`
- Create: `src/infrastructure/workspace/disposable-workspace.ts`
- Modify: `src/infrastructure/workspace/types.ts`
- Modify: `src/infrastructure/workspace/index.ts`
- Modify: `src/runner/tool-handlers.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `BenchmarkRuntimeConfig.outputRoot`, run ID, scenario ID, and fixture content.
- Produces: `RunArtifactLayout` and `DisposableWorkspace`.
- Required shape:

```typescript
export interface RunArtifactLayout {
  readonly outputRoot: string;
  readonly runDirectory: string;
  readonly manifestPath: string;
  readonly eventsPath: string;
  readonly transcriptPath: string;
  readonly metricsPath: string;
  readonly evaluationPath: string;
  readonly resultPath: string;
}

export interface DisposableWorkspace {
  readonly rootPath: string;
  dispose(): Promise<void>;
}
```

- [ ] **Step 1: Define canonical run paths**

Create `run-artifact-layout.ts` with a pure `createRunArtifactLayout(outputRoot, runId)` function and a `prepareRunArtifactLayout(layout)` function. Use exactly `db`, `runs`, `sweeps`, and `exports` as output-root children. Use `manifest.json`, `events.jsonl`, `transcript.jsonl`, `raw.log`, `metrics.json`, `evaluation.json`, `git.diff`, `diff-manifest.json`, and `result.json` under each run directory.

- [ ] **Step 2: Add disposable fake workspaces**

Create `disposable-workspace.ts`. Create the workspace beneath `<outputRoot>/runs/<runId>/workspace` with `mkdir`, write only scenario fixture files after validating relative paths, and remove only that exact workspace path in `dispose`. Do not copy the repository checkout. A path outside the workspace must throw before a file operation occurs.

- [ ] **Step 3: Eliminate unsafe tool fallbacks**

Update tool handlers so local file and command tools require `context.workspace`. Remove `process.cwd()` fallback for agent tool access. Build command environment from a minimal allowlist (`PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`) and merge only explicit tool environment values after rejecting sensitive provider-key names.

- [ ] **Step 4: Ignore generated artifacts and run an isolation smoke check**

Add `.benchmarks/` to `.gitignore`. Run a small Bun probe that creates an artifact layout and disposable workspace under a temporary directory, writes `created.txt` through the workspace root, and asserts that no `created.txt` appears at the repository root. Remove only the created temporary directory after the probe.

- [ ] **Step 5: Verify and commit the task**

Run `bun run typecheck` and `bun run src/scripts/quality-gate.ts`. Commit as `feat(workspace): isolate fake benchmark runs` and push to `origin main`.

### Task 3: Make Provider Selection and Fake Trajectories Deterministic

**Files:**
- Modify: `src/providers/types.ts`
- Modify: `src/providers/factory.ts`
- Modify: `src/providers/mock-adapter.ts`
- Modify: `src/runner/types.ts`
- Modify: `src/runner/runner-engine.ts`

**Interfaces:**
- Consumes: `BenchmarkRuntimeConfig.executionMode`, selected provider ID, and a run ID.
- Produces: a fake or live adapter plus `ScenarioResult.executionMode` and `ScenarioResult.simulated`.
- Required shape:

```typescript
export interface ProviderConfig {
  readonly executionMode?: ExecutionMode;
  readonly runId?: string;
  readonly providerId: ProviderId;
  readonly defaultModel?: string;
}

export interface ScenarioResult {
  readonly executionMode: ExecutionMode;
  readonly simulated: boolean;
}
```

- [ ] **Step 1: Make the factory mode-authoritative**

Update `createProviderAdapter` so fake mode always returns `MockProviderAdapter`, regardless of present keys. In live mode validate the chosen provider credential before constructing an adapter. Treat blank values as missing. Validate Anthropic with `ANTHROPIC_API_KEY`, OpenAI with `OPENAI_API_KEY`, and Google with `GEMINI_API_KEY` or `GOOGLE_API_KEY`. Keep Ollama and custom-provider behavior explicit and fail if live credentials or endpoints are unsupported.

- [ ] **Step 2: Rewrite mock behavior as a deterministic trajectory**

Replace random call IDs with `<runId>-turn-<n>`. Emit `list_directory` on turn zero with `{ path: ".", max_depth: 2 }`, emit `write_file` on turn one with `{ path: "benchmark-output.txt", content: "fake benchmark artifact\n" }`, and emit final text on turn two. Return zero from `calculateCostUSD` and preserve deterministic token counts.

- [ ] **Step 3: Propagate run provenance**

Add mandatory execution-mode and simulation fields to scenario results. Populate them in the runner from its resolved provider configuration. Ensure synthetic dry-run results also declare `executionMode: "fake"` and `simulated: true`; never let dry-run represent live provider evidence.

- [ ] **Step 4: Execute no-network fake provider smoke checks**

Run one benchmark with `OPENAI_API_KEY=present-but-unused`, fake mode, a temporary output root, and a temporary SQLite path. Confirm output identifies fake mode, the run succeeds only after valid fake tool calls, and `benchmark-output.txt` exists only inside the generated run workspace. Then invoke `--live` with no key and confirm it exits before an HTTP request.

- [ ] **Step 5: Verify and commit the task**

Run `bun run typecheck` and `bun run src/scripts/quality-gate.ts`. Commit as `feat(providers): make fake mode deterministic` and push to `origin main`.

### Task 4: Persist Provenance-Aware Sweep Evidence

**Files:**
- Modify: `src/sweep/types.ts`
- Modify: `src/sweep/sweep-engine.ts`
- Modify: `src/reporting/types.ts`
- Modify: `src/reporting/db.ts`
- Modify: `src/cli/commands.ts`

**Interfaces:**
- Consumes: runtime config, run artifact layout, `ScenarioResult`, and scenario definition.
- Produces: run `manifest.json`, `result.json`, a provenance-aware `RunRecord`, and a closed telemetry database.
- Required database fields:

```typescript
interface RunRecord {
  readonly executionMode: ExecutionMode;
  readonly simulated: boolean;
}
```

- [ ] **Step 1: Pass runtime configuration through every sweep cell**

Add `runtimeConfig` to `MatrixSweepConfig` and copy execution mode and output root into every cell. Derive checkpoint paths from `<outputRoot>/sweeps/<sweepId>/checkpoint.json`, database default from `<outputRoot>/db/benchmarks.sqlite`, and run directories from `RunArtifactLayout`.

- [ ] **Step 2: Persist all terminal outcomes**

Create a record for completed, failed, aborted, and timed-out cells. Use the real scenario category instead of `sweep`. Set `passedBenchmark` to false if any tool errors occurred or evaluation evidence is absent; preserve the runner termination reason in the status mapping. Ensure database closure occurs in a `finally` block.

- [ ] **Step 3: Write evidence files atomically**

Write `manifest.json` before provider execution and `result.json` after terminal status using a temporary sibling file followed by rename. Include execution mode, simulated status, provider ID, model ID, scenario ID, timestamps, and termination reason. Do not serialize credentials, custom authorization headers, or process environment.

- [ ] **Step 4: Run an end-to-end fake sweep inspection**

Run `bun run cli -- run --mock --output-dir <temporary-output> --scenario git-worktrees --skill using-git-worktrees --model claude-3-7-sonnet`. Inspect its generated SQLite row and `runs/<run-id>/manifest.json`; both must identify fake mode and simulated status. Confirm report output reads the SQLite path without creating files outside the temporary output root.

- [ ] **Step 5: Verify and commit the task**

Run `bun run typecheck` and `bun run src/scripts/quality-gate.ts`. Commit as `feat(reporting): persist benchmark execution provenance` and push to `origin main`.

### Task 5: Make the Public Fake-First Contract Truthful

**Files:**
- Modify: `README.md`
- Modify: `docs/usage-guide/getting-started/configuration.md`
- Modify: `docs/usage-guide/running-benchmarks/single-trial.md`
- Modify: `docs/usage-guide/cli-reference/commands.md`

**Interfaces:**
- Consumes: implemented CLI command names, `SKILL_BENCHMARKS_USE_MOCK`, `SKILL_BENCHMARKS_OUTPUT_DIR`, `--mock`, `--live`, and `--output-dir`.
- Produces: copy-pasteable commands that execute through `bun run cli --` or `bun run bin/skill-benchmarks`.

- [ ] **Step 1: Correct runnable entry points**

Replace `bun run src/cli/index.ts` examples with `bun run cli --`. Remove commands, flags, provider names, and lifecycle claims that remain unimplemented after Task 4. Do not promise `.env` loading or an `.env.example` file.

- [ ] **Step 2: Document fake and live behavior**

Document that fake mode is the default, accepts `SKILL_BENCHMARKS_USE_MOCK=true`, and performs no provider network request. Document `--live` and `SKILL_BENCHMARKS_USE_MOCK=false` as explicit live selection requiring a key. Include a fake run command with `--output-dir .benchmarks` and a live command whose key value is an obvious placeholder.

- [ ] **Step 3: Document the artifact layout**

Document the runtime root, SQLite index location, run evidence files, sweep checkpoint, and report export location. State that generated output is ignored by Git and that checked-in `data/` assets are demonstrations rather than CLI run results.

- [ ] **Step 4: Verify published commands**

Run every documented fake quickstart command with a temporary output root and a temporary database. Confirm help output includes the mode and output-root flags and that no command uses the non-executing source module entry point.

- [ ] **Step 5: Verify and commit the task**

Run `bun run typecheck` and `bun run src/scripts/quality-gate.ts`. Commit as `docs: document fake-first benchmark execution` and push to `origin main`.

## Plan Self-Review

- Spec coverage: Tasks 1 through 5 implement the fake/live control, isolated fake workspace, deterministic mock behavior, truthful provenance, structured output, and public usage portions of Capsules 1 and 2.
- Deliberate deferrals: Docker live-sandbox enforcement, shared secret redaction, replay envelope compatibility, report filters, CI repair, and testbed repair belong to later reliability capsules because they depend on the runtime contract created here.
- Constraint check: The plan adds no unit tests, requires deterministic executable probes, preserves `.olt`, keeps runtime output under `.benchmarks`, and requires a push after every verified task.
- Interface check: Task 1 emits the configuration required by Tasks 2 through 4; Task 2 emits the workspace and layout consumed by Tasks 3 and 4; Task 3 emits provenance consumed by Task 4; Task 5 documents only Task 1 through 4 interfaces.

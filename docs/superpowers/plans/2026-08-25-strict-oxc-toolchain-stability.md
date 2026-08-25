# Strict Oxc Toolchain Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade every direct dependency to a current caret range, migrate all runtime TypeScript compiler API use to Oxc, and make formatting, linting, typechecking, source policy, and operator verification one fail-closed delivery gate.

**Architecture:** Four bounded capsules preserve green commit boundaries. The compiler API migration lands before TypeScript 7 because the requested manifest-first order cannot typecheck independently; the dependency upgrade then becomes a mechanical green commit, repository-wide remediation wires the strict gates, and an independent read-only capsule verifies Darwin and Linux behavior.

**Tech Stack:** Bun 1.3.14, TypeScript 7.0.2, Oxc Parser 0.147.0, Oxlint 1.80.0, oxlint-tsgolint 7.0.2001, Oxfmt 0.65.0, GitHub Actions

**Spec:** `docs/superpowers/plans/2026-08-25-operator-truth-and-delivery-stability.md`

## Global Constraints

- Stability repairs only; no benchmark, provider, replay, report, arena, tournament, dashboard, server, or CLI feature additions.
- Source files contain zero comments and every maintained source file is strictly below 400 logical lines; no implementation capsule may introduce a comment.
- No unit-test files, unit-test framework, or unit-test runner; use deterministic runtime probes in temporary directories.
- No compatibility alias for TypeScript 5, compiler API vendoring, `any` escape layer, warning budget, exception rule, ignored maintained source, inline suppression, suppression comment, disabled rule, or per-path lint exception.
- Every direct regular and development dependency uses a caret range.
- `.olt` remains untouched.
- All probes write databases, logs, evidence, workspaces, and exports only below `mktemp -d` roots.
- Each implementation capsule runs `bun run typecheck`, `bun run quality`, and the capsule-specific deterministic probes before its commit.
- Each green implementation capsule is committed with the exact commit name below and immediately pushed to `origin main`.
- Capsule 4 is independent and read-only; it creates no tracked commit when verification is clean.

---

## Commit-Safe Ordering Decision

The requested logical order placed the TypeScript 7 manifest and configuration upgrade before the AST analyzer migration. That order cannot produce an independently valid commit:

- removing `baseUrl` and making the path target relative fixes the configuration errors;
- TypeScript 7 then reports 77 errors in `src/generator/ast-analyzer.ts` because the root `typescript` export no longer contains the compiler API;
- Task 10's planned TypeScript scanner would create a second runtime dependency on the removed facade.

Do not exclude these files, weaken typechecking, retain TypeScript 5 under an alias, or push a red commit. Capsule 1 therefore migrates both parser consumers while TypeScript 5 still compiles them. Capsule 2 then performs the requested latest-caret and TypeScript 7 upgrade. This is the only sequence in which every pushed boundary satisfies the repository invariant.

---

### Capsule 1: Replace Runtime TypeScript Compiler API Use

**Commit:** `fix(parser): replace TypeScript compiler API`

**Depends on:** Tasks 6 through 10 committed and pushed; no other toolchain capsule

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `src/generator/ast-analyzer.ts`
- Create: `src/generator/ast-source-view.ts`
- Create: `src/generator/ast-traversal.ts`
- Create: `src/generator/ast-metadata-extractor.ts`
- Create: `src/generator/errors.ts`
- Modify: `src/generator/index.ts`
- Modify: `src/scripts/source-policy/comment-policy.ts`

**Interfaces:**

- Preserve: `new AstAnalyzer(options?: AstAnalyzerOptions)`
- Preserve: `AstAnalyzer.analyzeSource(filePath: string, sourceCode: string): ExtractedCodebaseFeatures`
- Produce: `SourceAnalysisError extends Error` with stable code `SOURCE_ANALYSIS_FAILED` and the supplied file path
- Produce: `AstSourceView` with `text(span)`, `line(span)`, and `snippet(span, maximumLength)` methods over immutable source text
- Produce: `walkAst(root: Node, visit: (node: Node) => void): void`
- Consume in source policy: Oxc `ParseResult.comments` for TS, TSX, JS, and MJS comment detection
- Preserve: all public feature metadata types in `src/generator/types.ts`

- [ ] **Step 1: Establish the clean pre-migration evidence**

Run from the isolated implementation worktree:

```bash
git status --short
rg -n 'from ["'"']typescript["'"']|require\(["'"']typescript["'"']\)' src
bun run typecheck
bun run quality
```

Expected: only the known generator and any just-landed Task 10 scanner consume the compiler facade; both current gates exit zero; the worktree contains no unrelated edits.

- [ ] **Step 2: Add only the parser dependency**

Set `oxc-parser` to `^0.147.0` in root runtime dependencies and regenerate only the root Bun lock. Keep the existing TypeScript range in this capsule.

Run:

```bash
bun install
bun install --frozen-lockfile
```

Expected: both commands exit zero; the second does not alter `package.json` or `bun.lock`; no npm lockfile appears.

- [ ] **Step 3: Create the source-span boundary**

Implement `AstSourceView` in `src/generator/ast-source-view.ts` around the Oxc `Span` contract:

```ts
export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

export class AstSourceView {
  public constructor(filePath: string, sourceCode: string);
  public text(span: SourceSpan): string;
  public line(span: SourceSpan): number;
  public snippet(span: SourceSpan, maximumLength: number): string;
}
```

`line` is one-based. `snippet` trims and truncates to the exact supplied maximum. It must not normalize the underlying source before slicing.

- [ ] **Step 4: Create exhaustive traversal and metadata extraction**

Implement `walkAst` with Oxc visitor keys and no reflection into `parent` links. Implement metadata extractors for:

- named function declarations
- interface declarations and heritage
- class declarations, heritage, properties, methods, constructor parameters, accessibility, async, readonly, optional, and export state
- type aliases
- if, conditional, loop, case, catch, logical-expression branch counts
- throw, comparison, null-check, and type-guard edge conditions

Use source spans for type text, default expressions, computed names, throw text, comparison text, locations, and line numbers. Preserve the current defaults of `void`, `unknown`, `anonymous`, and `AnonymousClass` where the existing public contract uses them.

Make every existing `AstAnalyzerOptions` field operational instead of carrying dead configuration: `includeInternalSymbols: false` admits only exported top-level declarations, `calculateCyclomaticComplexity: false` returns the base complexity without branch traversal, and `maxDepth` bounds traversal from the program root. Reject non-positive or non-integer `maxDepth` at construction.

- [ ] **Step 5: Make the analyzer fail closed**

Call `parseSync(filePath, sourceCode, { astType: "ts" })`. If any returned diagnostic has severity `Error`, throw `SourceAnalysisError` before returning features. Never synthesize a partial feature set from malformed syntax.

Keep `src/generator/ast-analyzer.ts` as orchestration only. It must assemble the existing `ExtractedCodebaseFeatures` result and delegate source text, traversal, and metadata work to the focused files.

- [ ] **Step 6: Replace Task 10's comment scanner backend**

Use `parseSync` with language selection derived exactly from `.ts`, `.tsx`, `.js`, and `.mjs`. Reject every item in `ParseResult.comments`. Preserve the Task 10 policy for shebangs and the non-JavaScript languages through their existing classifiers.

Do not import TypeScript merely for scanning. Do not fall back to substring or regular-expression comment detection when parsing fails; a maintained source parse failure is itself a source-policy failure.

- [ ] **Step 7: Run analyzer parity and rejection probes**

Use one `bun -e` probe with `node:assert/strict` and an in-memory TypeScript sample containing an exported async function, optional/rest/default parameters, interface heritage, readonly and optional properties, a class with private/protected methods and constructor parameter properties, a type alias, if/else, loop, catch, logical operators, comparisons, and throw.

Assert exact names, source-derived type strings, one-based locations, branch counts, visibility, modifiers, edge condition types, and raw line count. Run the same probe twice and assert byte-identical JSON.

Exercise each analyzer option separately. Assert export filtering, disabled complexity calculation, traversal depth, and invalid-depth rejection so no configuration field remains inert.

Pass malformed TypeScript separately and assert `SourceAnalysisError`, `SOURCE_ANALYSIS_FAILED`, the input path, and absence of a returned feature object.

- [ ] **Step 8: Run no-legacy and source-policy adversaries**

Run:

```bash
! rg -n 'from ["'"']typescript["'"']|require\(["'"']typescript["'"']\)' src
! rg -n 'ts-ignore|ts-expect-error|oxlint-disable|eslint-disable|prettier-ignore|biome-ignore' src testbed
bun run quality
```

In a disposable archive, insert comment syntax inside a TypeScript string and a real comment beside it. Expected: the string is accepted and the comment is rejected. Repeat for TSX, JS, and MJS. A malformed maintained source file must fail policy rather than pass as comment-free.

- [ ] **Step 9: Verify, commit, and push**

Run:

```bash
bun run typecheck
bun run quality
bun run verify:operator
git diff --check
```

Require every command to exit zero, every source file to remain below 400 lines, and no generated artifact under the checkout. Stage only the files listed in this capsule, commit as `fix(parser): replace TypeScript compiler API`, and push `origin main`.

---

### Capsule 2: Upgrade All Direct Dependencies and TypeScript 7

**Commit:** `fix(toolchain): upgrade dependencies to latest`

**Depends on:** Capsule 1 pushed and independently reviewed

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `tsconfig.json`
- Modify: `testbed/package.json`
- Modify: `testbed/bun.lock`
- Modify: `testbed/frontend/package.json`
- Modify: `testbed/backend/package.json`

**Interfaces:**

- Produce: root and testbed frozen-install contracts
- Produce: TypeScript 7.0.x for root, frontend, and backend typecheck commands
- Preserve: Task 9's native supervisor and lock ownership
- Preserve: all runtime and public TypeScript types

- [ ] **Step 1: Reconfirm registry versions from primary package metadata**

Run `npm view` only as an audit query. Do not install with npm. Record the latest published version, dist tag, engines, and peers for every direct dependency.

Use these verified 2026-08-25 floors unless the registry has a newer stable latest at execution time:

```text
typescript ^7.0.2
oxlint ^1.80.0
oxlint-tsgolint ^7.0.2001
oxfmt ^0.65.0
oxc-parser ^0.147.0
js-yaml ^5.4.0
@types/node ^26.3.0
bun-types ^1.4.0
react ^19.2.8
react-dom ^19.2.8
@types/react ^19.2.18
@types/react-dom ^19.2.5
```

Any direct package added by Tasks 6 through 10 must also be queried and upgraded to its stable latest caret. Do not reintroduce `concurrently` after Task 9 removes it.

- [ ] **Step 2: Update every manifest atomically**

Apply caret ranges to regular and development dependencies in the root, testbed root, frontend, and backend manifests. Do not alter package identity, scripts, workspaces, exports, or Task 9 lifecycle behavior in this capsule.

Remove `compilerOptions.baseUrl` from root `tsconfig.json` and change the alias target from `src/*` to `./src/*`. Make no other TypeScript strictness change.

- [ ] **Step 3: Regenerate both Bun lockfiles**

Run the root install first and the testbed workspace install second:

```bash
bun install
bun install --cwd testbed
bun install --frozen-lockfile
bun install --cwd testbed --frozen-lockfile
```

Expected: the two non-frozen commands update only their owned locks; both frozen commands exit zero without any diff.

- [ ] **Step 4: Verify caret and lock contracts**

Use a read-only `bun -e` manifest probe to enumerate `dependencies` and `devDependencies` in all four manifests. Fail unless every value begins with `^` and every expected package exists in the appropriate manifest.

Print the direct resolved versions from both locks. Fail on an absent direct resolution, a duplicate direct package at incompatible versions, an npm lockfile, or a missing testbed lock.

- [ ] **Step 5: Verify TypeScript 7 identity and compatibility**

Run:

```bash
bun x tsc --version
bun run typecheck
bun run --cwd testbed typecheck
! rg -n 'baseUrl|"src/\*"' tsconfig.json
! rg -n 'from ["'"']typescript["'"']|require\(["'"']typescript["'"']\)' src
```

Expected: root and testbed report TypeScript 7.0.x; all typechecks exit zero; no runtime compiler facade import remains.

- [ ] **Step 6: Verify runtime surfaces under upgraded libraries**

Run the substantive `tdd` scenario catalog probe, YAML parse probe, fake/no-key operator smoke, testbed typecheck/build/start/stop, and the Task 9 container smoke. Use temporary outputs and an empty API-key environment.

Expected: all existing features retain their truthful pre-upgrade behavior; no provider request occurs; no result, database, log, workspace, or container survives outside the temporary root.

- [ ] **Step 7: Verify, commit, and push**

Run:

```bash
bun run typecheck
bun run quality
bun run verify:operator
git diff --check
```

Require zero failures and a clean repository snapshot apart from the listed files. Commit as `fix(toolchain): upgrade dependencies to latest` and push `origin main`.

---

### Capsule 3: Normalize the Repository and Enforce Oxc Gates

**Commit:** `fix(quality): enforce Oxc delivery gates`

**Depends on:** Capsule 2 pushed and independently reviewed

**Files:**

- Create: `.oxlintrc.json`
- Create: `.oxfmtrc.json`
- Modify: `package.json`
- Modify: `src/scripts/quality-gate.ts` to expose the maintained-root inventory consumed by the Oxc structural probes
- Modify: `.github/workflows/benchmark-matrix.yml`
- Modify: Oxfmt-supported maintained files below `src/`, `bin/`, `testbed/`, `.github/`, `scenarios/`, `docs/usage-guide/`, and `docs/architecture/`, plus root `package.json`, `tsconfig.json`, and `README.md`
- Modify: maintained source below `src/`, `testbed/frontend/src/`, and `testbed/backend/src/` reported by the strict Oxlint command

**Interfaces:**

- Produce: `bun run format` as the only write-mode formatter command
- Produce: `bun run format:check` as a read-only formatter gate
- Produce: `bun run lint` as strict type-aware, type-checking Oxlint with denied warnings
- Produce: `bun run test` ordered as format check, lint, TypeScript, source policy, and operator verification
- Preserve: `bun run quality` as source policy only
- Preserve: `bun run verify:operator` as the deterministic fake/no-key integration authority

- [ ] **Step 1: Add the one root Oxlint configuration**

Create `.oxlintrc.json` with exactly this stable correctness profile:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["import", "promise", "typescript", "unicorn", "oxc"],
  "categories": {
    "correctness": "error"
  },
  "options": {
    "typeAware": true,
    "typeCheck": true
  },
  "env": {
    "builtin": true
  }
}
```

Do not add `rules`, `overrides`, ignore patterns for maintained source, React, JSX accessibility, Node style, nursery, style, pedantic, or restriction categories.

- [ ] **Step 2: Add the one root Oxfmt configuration**

Create `.oxfmtrc.json` exactly as follows:

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "ignorePatterns": [
    ".git/**",
    ".olt/**",
    ".superpowers/**",
    ".benchmarks/**",
    "node_modules/**",
    "testbed/node_modules/**",
    "dist/**",
    "data/**",
    "docs/archive/**",
    "docs/blueprints/**",
    "docs/superpowers/**",
    "bun.lock",
    "testbed/bun.lock"
  ]
}
```

Do not add nested formatter configurations or formatting exceptions for maintained files.

- [ ] **Step 3: Wire scripts without recursive gates**

Set the root command surface to:

```text
format = oxfmt --write --disable-nested-config src bin testbed .github scenarios package.json tsconfig.json README.md docs/usage-guide docs/architecture
format:check = oxfmt --check --disable-nested-config src bin testbed .github scenarios package.json tsconfig.json README.md docs/usage-guide docs/architecture
lint = oxlint --config .oxlintrc.json --deny-warnings --report-unused-disable-directives src testbed/frontend/src testbed/backend/src
typecheck = tsc --noEmit && bun run --cwd testbed typecheck
quality = bun run src/scripts/quality-gate.ts
test = bun run format:check && bun run lint && bun run typecheck && bun run quality && bun run verify:operator
```

No constituent script may invoke `test` or another constituent except the explicit testbed typecheck. Do not invoke `bun test`.

- [ ] **Step 4: Apply one deterministic format pass**

Snapshot tracked paths, run `bun run format`, and inspect every changed path. Reject any change below ignored roots or to either lockfile.

Immediately run source policy. Split a formatted source module if it reaches 400 lines; do not change the line ceiling or compact code merely to evade it.

- [ ] **Step 5: Resolve the complete strict lint inventory**

Run `bun run lint` repeatedly until it exits zero. Apply these bounded repair rules:

- delete dead bindings rather than underscore-renaming them
- use `Array.from` or literals for ambiguous arrays
- replace control-character regexes with explicit character-code scanning
- await owned promises or attach explicit rejection handling
- restructure `finally` flow so cleanup cannot overwrite the primary result
- narrow unknown values before interpolation and stringification
- remove redundant string-union members
- use lexical callbacks instead of aliasing `this`

Any diagnostic whose repair would change a public behavior, benchmark target defect, persistence claim, or network lifecycle stops the capsule and returns to the owning stability task. It is not suppressed.

- [ ] **Step 6: Run suppression and configuration adversaries**

Run exact structural probes that fail if:

- `.oxlintrc.json` has `rules`, `overrides`, or ignored maintained source
- any nested `.oxlintrc`, `.oxfmtrc`, ESLint, Prettier, or Biome configuration exists
- maintained source contains a linter, formatter, or TypeScript suppression token
- `lint` omits type-aware analysis, type checking, or denied warnings
- `format:check` invokes write mode

In a disposable archive, add an unused binding, a floating promise, formatting drift, and an inline disable one at a time. Expected: each respective gate exits nonzero and no gate modifies the disposable file in check mode.

- [ ] **Step 7: Preserve unsupported-language truth**

Run `gofmt -l` and require no output. Run Task 9's Go build or vet, shell syntax, process lifecycle, and Docker build probes. Ensure neither Oxfmt output nor documentation claims Go, shell, or Docker formatting coverage.

- [ ] **Step 8: Wire the single CI command**

After Task 6's workflow repair, make its verification job perform only:

```text
bun install --frozen-lockfile
bun install --cwd testbed --frozen-lockfile
bun run test
```

Retain Task 6's exact deterministic fake diagnostic and artifact assertions through `verify:operator`. Remove duplicate `tsc`, quality, lint, format, empty regression, or unsupported command invocations from the workflow. Do not create a second competing quality workflow.

- [ ] **Step 9: Run the full gate twice and prove read-only behavior**

Capture a repository snapshot excluding ignored dependency directories. Run `bun run test` twice in an empty API-key environment. Compare the snapshot after each run.

Expected: both runs exit zero; command order is format check, lint, TypeScript, source policy, operator verification; no tracked or untracked runtime output appears; every temporary process, listener, container, and directory is cleaned.

- [ ] **Step 10: Verify, commit, and push**

Run fresh:

```bash
bun run format:check
bun run lint
bun run typecheck
bun run quality
bun run verify:operator
bun run test
git diff --check
```

Require every command to exit zero, no source comments, no source file at or above 400 lines, and no unrelated diff. Commit as `fix(quality): enforce Oxc delivery gates` and push `origin main`.

---

### Capsule 4: Independent Darwin and Linux Verification

**Commit:** none when clean; any repair returns to its owning capsule

**Depends on:** Capsule 3 pushed; fresh reviewer with no implementation context

**Files:**

- Read: all three implementation commits and their diffs
- Read: `package.json`, `bun.lock`, `testbed/package.json`, `testbed/bun.lock`
- Read: `.oxlintrc.json`, `.oxfmtrc.json`, `tsconfig.json`
- Read: `.github/workflows/benchmark-matrix.yml`
- Read: generator parser modules and source-policy modules
- Write only ignored evidence below `.superpowers/sdd/2026-08-25-stability-loop/`

**Interfaces:**

- Consume: the canonical `bun run test` gate
- Produce: a clean or blocking verdict with exact reproductions
- Produce no source, manifest, lock, workflow, tag, release, or commit

- [ ] **Step 1: Review commit and package boundaries**

Verify each implementation commit contains only its declared files and that each commit was pushed. Confirm direct dependencies are carets, the two locks are present, no npm lock exists, and the packed CLI excludes `.olt`, `.superpowers`, databases, logs, and internal source.

- [ ] **Step 2: Verify on Darwin from a clean archive**

Create a tracked-file archive under `mktemp -d`, perform both frozen installs, print Bun, Node, TypeScript, Oxlint, Oxfmt, and Oxc Parser versions, and run `bun run test` twice with provider keys absent.

Expected: identical success, no repository writes, no network provider calls, and no leaked process or container.

- [ ] **Step 3: Verify on Linux through the pushed CI job**

Inspect the exact GitHub Actions run for the pushed Capsule 3 SHA. Require a hosted Linux environment with a compatible Node version, both frozen installs, and the one canonical `bun run test` command. Download and inspect only the Task 6 diagnostic artifact.

Expected: the job exits zero, the artifact is present and non-authoritative as designed, and no empty regression or skipped toolchain path appears in logs.

- [ ] **Step 4: Reproduce fail-closed adversaries in disposable archives**

Independently prove nonzero outcomes for stale formatting, unused binding, floating promise, malformed TypeScript, inline suppression, missing Oxc config, missing lock, exact direct dependency version, 400-line source, real source comment, malformed scenario selection, and missing fake evidence.

Expected: every adversary fails at its owning boundary and leaves no output under the checkout.

- [ ] **Step 5: Publish the review verdict**

Write an ignored Markdown review containing commit SHAs, tool versions, Darwin and Linux command exits, artifact inspection, adversary results, maximum maintained source line count, and exact blockers.

If clean, report that no commit is required. If blocked, send the smallest exact repair to Capsule 1, 2, or 3's owner; do not patch from the review lane.

---

## Final Completion Gate

The sequence is complete only when:

- Capsules 1 through 3 are individually green, committed with the exact names above, and pushed;
- Capsule 4 independently verifies the pushed SHA on Darwin and hosted Linux;
- no runtime import from the TypeScript compiler facade remains;
- TypeScript 7.0.x is used by every TypeScript package;
- every direct regular and development dependency is a latest caret range with frozen root and testbed locks;
- Oxfmt check, strict type-aware Oxlint, TypeScript, source policy, and operator verification all fail closed through `bun run test`;
- no suppression, exception, ignored maintained source, empty test runner, unsupported coverage claim, source comment, 400-line source file, checkout-local runtime artifact, leaked process, or fabricated benchmark authority remains.

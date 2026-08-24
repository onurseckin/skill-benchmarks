# Repository Invariants & Agent Guidelines

## 1. Zero Comments Rule
- Source code files must contain **zero comments** (no `//`, `/* */`, JSDoc blocks, or Python `#` comments).
- All code must be strictly self-documenting through explicit, descriptive naming of symbols, functions, types, and variables.

## 2. Strict File Length Ceiling
- Every source file must remain strictly under **400 lines of code** (target: 150–300 lines).
- Any module exceeding 400 lines must be aggressively decomposed into smaller, single-responsibility submodules.

## 3. No Unit Tests (Implementation Velocity)
- Do not author or require unit tests for implementation modules.
- Verification and quality assurance are enforced via:
  - TypeScript strict typechecking (`tsc --noEmit` / `bun run typecheck`)
  - Automated quality gate script (`bun run src/scripts/quality-gate.ts`)
  - Deterministic runtime execution in Docker sandbox environments

## 4. Modularity & Clean Folder Hierarchy
- High modularity with clean separation of concerns across domain directories:
  - `src/infrastructure/` — Docker container pool, volume management, cgroups telemetry
  - `src/providers/` — Frontier LLM API adapters (Anthropic Claude, Google Gemini, OpenAI)
  - `src/runner/` — Scenario execution loop, tool interception, timing collectors
  - `src/eval/` — Evaluation engine, deterministic validators, LLM judge scoring
  - `src/reporting/` — Data store, SQLite queries, leaderboard generators
  - `src/shared/` — Common utilities, errors, types, constants
  - `src/scripts/` — Project-wide verification and quality gate scripts
- Strict unidirectional imports: domain modules import from `shared/`, never circular cross-domain imports.

## 5. Quality Verification Command
- Run the automated quality gate before submitting any task:
  ```bash
  bun run src/scripts/quality-gate.ts
  ```

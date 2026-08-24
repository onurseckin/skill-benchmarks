# 03. Scenario Schema and Catalog Specification

## 1. Executive Summary

This document specifies the declarative YAML schema for benchmark scenarios, the fixture layout rules, and the initial catalog of benchmark tasks. Every scenario is grounded in the top developer agent skills cataloged in `skill-list/skill-list.md` (covering Debugging, Testing & QA, Security, Documentation, Code Review, and Architecture).

---

## 2. Declarative Scenario Schema (`scenario.yaml`)

Every benchmark scenario is defined by a `scenario.yaml` file in its fixture directory.

### 2.1 Zod Schema Definition

```typescript
import { z } from "zod";

export const ScenarioCategorySchema = z.enum([
  "debugging",
  "testing-qa",
  "security",
  "documentation",
  "code-review",
  "refactoring",
  "devops-infra"
]);

export const DifficultySchema = z.enum(["easy", "medium", "hard", "expert"]);

export const SetupStepSchema = z.object({
  command: z.string(),
  timeoutSeconds: z.number().default(60),
  allowFailure: z.boolean().default(false)
});

export const DeterministicCheckSchema = z.object({
  type: z.enum(["command", "file_exists", "file_contains", "git_diff_matches", "ast_lint"]),
  description: z.string(),
  command: z.string().optional(),
  targetFile: z.string().optional(),
  pattern: z.string().optional(),
  expectedExitCode: z.number().default(0),
  weight: z.number().min(0).max(1.0).default(1.0)
});

export const JudgeRubricDimensionSchema = z.object({
  name: z.string(),
  description: z.string(),
  weight: z.number().min(0).max(1.0),
  criteria: z.record(z.string(), z.string()) // e.g. "1": "Fails...", "5": "Flawless..."
});

export const EvaluationConfigSchema = z.object({
  deterministicChecks: z.array(DeterministicCheckSchema).default([]),
  judgePromptTemplate: z.string().optional(),
  judgeRubrics: z.array(JudgeRubricDimensionSchema).default([]),
  passThresholdScore: z.number().min(0).max(100).default(80)
});

export const ScenarioSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  category: ScenarioCategorySchema,
  difficulty: DifficultySchema,
  description: z.string(),
  tags: z.array(z.string()).default([]),
  
  // Fixture & Environment configuration
  workspace: z.object({
    fixtureDir: z.string(), // Relative to scenarios root
    env: z.record(z.string(), z.string()).default({}),
    cleanGitState: z.boolean().default(true)
  }),

  // Preparation steps executed before agent starts
  setup: z.array(SetupStepSchema).default([]),

  // Agent instruction prompt
  prompt: z.string().min(1),

  // Execution constraints
  agentConfig: z.object({
    maxTurns: z.number().default(15),
    maxWallClockTimeSeconds: z.number().default(300),
    maxCostUSD: z.number().default(1.00),
    allowedTools: z.array(z.string()).default(["run_command", "read_file", "write_file", "edit_file_content", "list_directory", "grep_search"])
  }),

  // Evaluation definitions
  evaluation: EvaluationConfigSchema
});

export type Scenario = z.infer<typeof ScenarioSchema>;
```

---

## 3. Directory Layout for Fixtures and Scenarios

```
scenarios/
├── catalog.json (Generated Index)
├── debugging/
│    ├── memory-leak-stream/
│    │    ├── scenario.yaml
│    │    └── fixture/
│    │         ├── package.json
│    │         ├── src/stream-processor.ts
│    │         └── tests/stream.spec.ts
│    └── race-condition-sqlite/
│         ├── scenario.yaml
│         └── fixture/
├── testing-qa/
│    └── tdd-token-bucket/
├── security/
│    └── idor-auth-middleware/
├── documentation/
│    └── adr-database-migration/
└── code-review/
     └── pr-concurrency-flaw/
```

---

## 4. Scenario Catalog Grounded in `skill-list.md`

### 4.1 Category 1: Bug Solving & Debugging
*Target Skills: `diagnosing-bugs`, `safe-debug`, `golang-troubleshooting`, `azure-diagnostics`*

#### Scenario 1.1: `node-stream-backpressure-leak`
- **Difficulty**: Hard
- **Context**: A Node.js streaming transform pipeline holds unconsumed chunk buffers in memory when downstream sockets pause, triggering process OOM under high concurrency.
- **Agent Task**: Diagnose the memory leak using reproduction tests, implement correct backpressure handling with `drain` event listeners, and ensure test suite passes.
- **Verification**: `bun test tests/stream.spec.ts` passes; heap allocation test asserts bounded memory usage under 100,000 streamed chunks.

#### Scenario 1.2: `golang-goroutine-channel-deadlock`
- **Difficulty**: Medium
- **Context**: A worker pool in Go deadlocks when worker error channels are unbuffered and parent context cancels prematurely.
- **Agent Task**: Identify the synchronization leak, fix channel lifecycle, and verify `go test -race ./...` passes without hangs.

---

### 4.2 Category 2: Testing & QA
*Target Skills: `tdd`, `qa`, `webapp-testing`, `playwright-cli`, `playwright-best-practices`*

#### Scenario 2.1: `tdd-sliding-window-rate-limiter`
- **Difficulty**: Medium
- **Context**: A greenfield distributed rate-limiter component with sliding window log algorithm must be implemented strictly following Test-Driven Development.
- **Agent Task**: Write comprehensive failing unit tests covering edge cases (clock skew, burst traffic, boundary thresholds), then implement the class until all tests pass.
- **Verification**: Unit tests achieve 100% statement and branch coverage (`bun test --coverage`), lint clean, no type errors.

#### Scenario 2.2: `playwright-flaky-e2e-stabilization`
- **Difficulty**: Hard
- **Context**: An end-to-end Playwright test suite suffers from flakiness due to race conditions in client hydration and toast notifications.
- **Agent Task**: Refactor tests to utilize auto-retrying locators, explicit state assertions, and mock API network fixtures instead of arbitrary timeouts.

---

### 4.3 Category 3: Security
*Target Skills: `firebase-security-rules-auditor`, `skill-vetter`, `security-review`, `azure-compliance`, `pci-compliance`*

#### Scenario 3.1: `fastify-idor-tenant-isolation`
- **Difficulty**: Hard
- **Context**: A multi-tenant REST API has a broken object-level authorization (IDOR) flaw allowing Organization A users to access Organization B documents by manipulating route UUIDs.
- **Agent Task**: Perform a security audit of the route handlers, identify all vulnerable endpoints, write regression tests proving the exploit, and fix the authorization guards.
- **Verification**: Exploit test suite (`bun test tests/security.spec.ts`) passes; AST check validates all database queries include tenant ID predicates.

#### Scenario 3.2: `jwt-algorithm-confusion-patch`
- **Difficulty**: Medium
- **Context**: An authentication middleware verifies JWT signatures without pinning the `algorithms` array, allowing algorithm substitution (`none` or HMAC-with-RSA-public-key).
- **Agent Task**: Identify cryptographic flaw, pin allowed signature algorithms, and implement strict key verification.

---

### 4.4 Category 4: Documentation
*Target Skills: `documentation-writer`, `create-readme`, `documentation-and-adrs`, `golang-documentation`, `readme-blueprint-generator`*

#### Scenario 4.1: `diataxis-api-reference-synthesis`
- **Difficulty**: Medium
- **Context**: A complex payment gateway client library lacks documentation.
- **Agent Task**: Analyze source code and produce a complete Diátaxis-compliant documentation set (`Tutorials`, `How-To Guides`, `Reference`, and `Explanation`).
- **Verification**: Evaluated by LLM Judge on completeness, technical correctness, executable code examples, and structure.

#### Scenario 4.2: `adr-event-driven-architecture`
- **Difficulty**: Hard
- **Context**: A monolithic order processing system is transitioning to an event-driven Kafka architecture.
- **Agent Task**: Author a formal Architecture Decision Record (ADR) detailing Context, Decision, Consequences, Data Consistency Models, and Rollback Strategy.

---

### 4.5 Category 5: Code Review & Quality
*Target Skills: `code-review`, `code-review-excellence`, `code-review-and-quality`, `frontend-code-review`, `code-reviewer`*

#### Scenario 5.1: `pr-concurrency-and-perf-audit`
- **Difficulty**: Hard
- **Context**: A Pull Request introduces an N+1 query loop and an unhandled race condition in an optimistic locking transaction.
- **Agent Task**: Review the PR diff, produce actionable and constructive line-by-line review comments identifying the performance and correctness flaws, and suggest concrete replacement diffs.
- **Verification**: Graded against Ground Truth Flaw Matrix (recall of true bugs vs. hallucinated false positives).

---

## 5. Sample Scenario YAML Definition

Below is a complete, production-grade `scenario.yaml` for `node-stream-backpressure-leak`:

```yaml
id: node-stream-backpressure-leak
name: "Fix Memory Leak in Node.js Stream Pipeline"
version: "1.0.0"
category: debugging
difficulty: hard
description: "Diagnose and repair unhandled backpressure in a transform stream causing OOM errors under high-throughput consumer stall."
tags:
  - nodejs
  - streams
  - memory-leak
  - backpressure

workspace:
  fixtureDir: "debugging/node-stream-backpressure-leak/fixture"
  cleanGitState: true
  env:
    NODE_ENV: "test"

setup:
  - command: "bun install"
    timeoutSeconds: 45

prompt: |
  We have received reports of Out-Of-Memory (OOM) crashes in our stream processing service when clients experience slow network connections.
  The service is located in `src/stream-pipeline.ts`.
  
  Your goals:
  1. Inspect `src/stream-pipeline.ts` and `tests/stream.spec.ts`.
  2. Run the test suite using `bun test` to observe current behavior and failures.
  3. Identify the root cause of the memory buildup during stream backpressure.
  4. Fix the pipeline implementation so that backpressure is respected and memory remains bounded.
  5. Ensure all existing and new tests pass with zero regressions.

agentConfig:
  maxTurns: 12
  maxWallClockTimeSeconds: 240
  maxCostUSD: 0.75
  allowedTools:
    - run_command
    - read_file
    - write_file
    - edit_file_content
    - list_directory
    - grep_search

evaluation:
  passThresholdScore: 85
  deterministicChecks:
    - type: command
      description: "Verify all unit and stress tests pass cleanly"
      command: "bun test"
      expectedExitCode: 0
      weight: 0.60
    - type: command
      description: "Typecheck TypeScript code"
      command: "bun run typecheck"
      expectedExitCode: 0
      weight: 0.20
    - type: command
      description: "Linter check with zero errors"
      command: "bun run lint"
      expectedExitCode: 0
      weight: 0.20

  judgeRubrics:
    - name: "Root Cause Accuracy"
      description: "How accurately did the agent identify the backpressure mechanism failure without unnecessary refactoring?"
      weight: 0.50
      criteria:
        "1": "Agent completely misdiagnosed the issue and made irrelevant edits."
        "3": "Agent found the issue but applied a hacky buffer flush rather than proper backpressure pause/drain."
        "5": "Agent pinpointed unhandled .write() return false / drain listener and implemented clean Node stream backpressure semantics."
    - name: "Code Cleanliness and Minimalism"
      description: "Did the agent keep edits minimal and idiomatic?"
      weight: 0.50
      criteria:
        "1": "Massive unnecessary refactor, breaking types or comments."
        "3": "Moderate extra changes, some redundant code."
        "5": "Laser-focused, idiomatic TypeScript with zero unnecessary diff churn."
```

---

## 6. Matrix Generation (A/B and A/B/n Sweeps)

The harness orchestrates full matrix sweeps to evaluate skills across multiple models and controls:

$$\text{Matrix} = \text{Scenarios} \times \text{Skills (Control, Skill A, Skill B)} \times \text{Models} \times \text{Repetitions}$$

Example CLI Matrix Invocation:
```bash
bun run bench --category debugging \
  --models claude-3-7-sonnet-20250219,gpt-4o \
  --skills vanilla,diagnosing-bugs,safe-debug \
  --repeats 3 \
  --concurrency 4
```

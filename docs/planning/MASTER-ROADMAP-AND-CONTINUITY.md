# Master Roadmap & Session Continuity Blueprint

## Executive Summary & System Philosophy

The `skill-benchmarks` platform is an industrial-grade, multi-agent benchmarking and evaluation harness designed to assess autonomous AI coding agents executing real-world skills from the canonical `skills.sh` ecosystem. The repository is architected under strict engineering invariants:

1. **Zero-Comment Invariant**: 100% self-documenting code with zero inline `//`, `/* */`, or JSDoc comments across all TypeScript source files.
2. **File Size Ceiling**: Strictly `<= 400` lines of code per source file across all subsystems.
3. **Strict Type Safety**: Complete TypeScript strictness with 0 `any` annotations and 0 compiler suppressions (`@ts-ignore`, `@ts-expect-error`, `eslint-disable`).
4. **Hermetic Docker Sandbox Isolation**: Container pool lifecycle management with cgroups v2 resource accounting, virtual network namespace control, and ephemeral volume snapshots.
5. **Evidence-Gated Evaluation**: Score and pass claims require validated nonempty evaluation evidence, exact provenance, and shared benchmark authority.
6. **Neo-Brutalist Visual Telemetry**: High-contrast, dark monochrome (`#000000` / `#FFFFFF`) interactive web dashboard, SVG charts, ANSI TUI players, and binary WebSocket terminal streaming.

---

## Section 1: Executive Repository Status & Complete Subsystem Inventory

### 1.1 Codebase Metrics & Global Health

- **Total TypeScript Modules**: 24 distinct subsystems + runtime verification scripts
- **Total Source Files**: 134 TypeScript source files in `src/`
- **Total Lines of Source Code**: 30,664 LOC strictly meeting the 400-line ceiling
- **Total Scenarios**: 12 benchmark scenarios across deterministic, composite, security, and conversational domains
- **Total OLT Run Capsules**: 40 capsules registered in `.olt/capsules/`
- **Verification Suite**: `bun run typecheck` and `bun run src/scripts/quality-gate.ts` passing with 100% compliance

```
========================================================================================
                          SKILL-BENCHMARKS ARCHITECTURAL TOPOLOGY
========================================================================================

           ┌────────────────────────────────────────────────────────┐
           │              Universal CLI & Web Server API            │
           │           (src/cli/, src/server/, src/tunnel/)         │
           └───────────┬────────────────────────────────┬───────────┘
                       │                                │
        ┌──────────────▼─────────────┐   ┌──────────────▼─────────────┐
        │  Matrix Sweep Orchestrator │   │  Live Streaming Broadcaster│
        │  (src/sweep/, src/runner/) │   │  (src/streaming/, replay/) │
        └──────────────┬─────────────┘   └──────────────┬─────────────┘
                       │                                │
  ┌────────────────────┴────────────────────────────────┴────────────────────┐
  │                               Core Engine                                │
  │   ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐    │
  │   │ Providers Adapter │  │ Skills Catalog    │  │ Adaptive Optimizer│    │
  │   │  (src/providers/) │  │   (src/skills/)   │  │  (src/optimizer/) │    │
  │   └─────────┬─────────┘  └─────────┬─────────┘  └─────────┬─────────┘    │
  │             │                      │                      │              │
  │   ┌─────────▼──────────────────────▼──────────────────────▼─────────┐    │
  │   │              Hermetic Docker Sandbox & Workspace                │    │
  │   │     (src/infrastructure/container, workspace, telemetry)        │    │
  │   └─────────┬─────────────────────────────────────────────┬─────────┘    │
  │             │                                             │              │
  │   ┌─────────▼─────────┐                                                   │
  │   │  Chaos Injection  │                                                   │
  │   │   (src/chaos/)    │                                                   │
  │   └─────────┬─────────┘                                                   │
  └─────────────┼─────────────────────────────────────────────────────────────┘
                │
  ┌─────────────▼────────────────────────────────────────────────────────────┐
  │                           Evaluation & Reporting                         │
  │   ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐    │
  │   │ Deterministic AST │  │ Benchmark Authority│ │ Unranked Diagnostics│   │
  │   │    (src/eval/)    │  │   (src/shared/)   │  │   (src/arena/)    │    │
  │   └─────────┬─────────┘  └─────────┬─────────┘  └─────────┬─────────┘    │
  │             │                      │                      │              │
  │   ┌─────────▼──────────────────────▼──────────────────────▼─────────┐    │
  │   │        SQLite Database, Leaderboards & Neo-Brutalist UI         │    │
  │   │   (src/reporting/, src/dashboard-ui/, src/analytics/, src/ci/)  │    │
  │   └─────────────────────────────────────────────────────────────────┘    │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

### 1.2 Delivered Subsystems Inventory

| Subsystem Module | Location | Files | Lines | Primary Responsibilities & Architectural Scope |
| :--- | :--- | :---: | :---: | :--- |
| **Infrastructure: Container** | `src/infrastructure/container` | 9 | 1,598 | Docker sandbox client, pool pre-warming, container state machine, garbage collection, and cgroups v2 resource enforcement. |
| **Infrastructure: Workspace** | `src/infrastructure/workspace` | 7 | 1,190 | Ephemeral workspace hydration from tar archives, fast SHA-256 tree hashing, diff generation, and memory storage. |
| **Infrastructure: Telemetry** | `src/infrastructure/telemetry` | 9 | 1,654 | Structured event scribing, error taxonomy hierarchies, resource profiling, diagnostic snapshots, and execution metric summaries. |
| **Frontier Providers** | `src/providers` | 7 | 1,662 | Multi-model adapters for Anthropic Claude, Google Gemini, OpenAI GPT, token pricing engine, streaming normalization, and adapter factory. |
| **Canonical Skills** | `src/skills` | 9 | 2,035 | Master canonical registry of 29 skills.sh skills across 7 domains, catalog parser, downloader, schema validators, and documentation formatter. |
| **Runner & Sandbox** | `src/runner` | 9 | 1,994 | Scenario execution loop, tool dispatcher, isolated bash/filesystem interceptor handlers, context window token budget manager, and matrix executor. |
| **Evaluation Engine** | `src/eval` | 6 | 1,374 | Nonempty deterministic evidence, optional judge evidence, composite validation, and evidence digest binding. |
| **Reporting & Persistence** | `src/reporting` | 6 | 1,679 | SQLite telemetry database (WAL mode), statistical aggregator, markdown leaderboard generator, and neo-brutalist HTML dashboard compiler. |
| **Universal CLI** | `src/cli` | 5 | 1,429 | Interactive command-line interface, subcommands router (`run`, `sweep`, `eval`, `replay`, `server`, `skills`), flag parser, and ANSI status formatters. |
| **Sweep Orchestrator** | `src/sweep` | 5 | 1,267 | High-throughput matrix runner, adaptive token-bucket rate limiter, execution checkpointing, and dynamic concurrency worker pools. |
| **Replay Visualizer** | `src/replay` | 5 | 1,180 | Step-by-step ANSI TUI trajectory player, standalone SVG/HTML web visual replay player, and trajectory state scrubber. |
| **CI / CD Bot** | `src/ci` | 4 | 860 | Automated GitHub Actions benchmark workflow contract, statistical regression detection (Welch\'s t-test, Fisher\'s exact test), and PR leaderboard commenter. |
| **Server & HTTP API** | `src/server` | 4 | 861 | Lightweight native Bun HTTP and SSE telemetry server, RESTful metrics endpoints, and live agent status streams. |
| **Scenario Synthesizer** | `src/generator` | 4 | 914 | Autonomous benchmark scenario generator, skill documentation AST analyzer, and self-contained verification gate authoring. |
| **Dashboard UI** | `src/dashboard-ui` | 5 | 1,092 | Client-side SPA components in monochrome neo-brutalist design, reactive state management, and real-time telemetry stream consumers. |
| **Arena Diagnostics** | `src/arena` | 3 | 1,159 | Claim-free debate and jury insufficiency diagnostics without synthetic turns, verdicts, or ratings. |
| **Semantic Analytics** | `src/analytics` | 4 | 890 | Semantic trajectory analyzer, anomaly detector, multi-label failure mode taxonomy classifier, and error recovery tracker. |
| **PTY Terminal Tunnel** | `src/tunnel` | 4 | 1,243 | Live terminal streaming multiplexer, PTY manager, bidirectional WebSocket streaming tunnel, and remote session viewer. |
| **Chaos Engineering** | `src/chaos` | 4 | 812 | Docker fault injector, network latency and packet loss simulation (`tc netem`), process killing, and disk pressure chaos orchestrator. |
| **Adaptive Optimizer** | `src/optimizer` | 4 | 863 | Dynamic adaptive token and latency budget optimizer, PID token velocity controller, and multi-tier model cascade routing. |
| **Conversational Dialog** | `src/dialog` | 4 | 985 | Multi-turn conversational evaluation pipeline, stakeholder persona simulator, and rubric-based interview evaluator. |
| **Streaming Canvas** | `src/streaming` | 4 | 984 | Real-time WebSocket/SSE telemetry broadcaster and HTML5 Canvas visual renderer for live agent trajectories. |
| **Verification Scripts** | `src/scripts` | 4 | 971 | Quality gate verification script, benchmark trial runner, canonical skills sync script, and scenario validator. |
| **Total Fleet** | `src/` | **134** | **30,664** | **Full Enterprise-Grade Autonomous Skill Benchmarking Architecture** |

---

### 1.3 Complete OLT Capsule Fleet Inventory (40 Capsules)

| Capsule ID | Generation / Ref | Target Subsystem | Primary Deliverable Scope | Status |
| :--- | :--- | :--- | :--- | :--- |
| `mind-gen-1` | Gen 1 Mind | Core Architecture | Baseline mind loop and repository charter | Sealed |
| `mind-gen-2` | Gen 2 Mind | Infrastructure | Container sandboxing and provider foundations | Sealed |
| `mind-gen-3` | Gen 3 Mind | Evaluation & Scenarios | Initial scenario authoring and scoring rubrics | Sealed |
| `mind-gen-4` | Gen 4 Mind | Reporting & DB | SQLite persistence and markdown leaderboards | Sealed |
| `mind-gen-5` | Gen 5 Mind | CLI & Sweep | Matrix execution and CLI runner contracts | Sealed |
| `mind-gen-6` | Gen 6 Mind | Replay & CI | Interactive TUI visualizers and regression bots | Sealed |
| `mind-gen-7` | Gen 7 Mind | Advanced Features | AST generation and server endpoints | Sealed |
| `mind-gen-8` | Gen 8 Mind | Arena & Analytics | Arena diagnostics, insufficiency arbitration, anomaly classification | Sealed |
| `mind-gen-9` | Gen 9 Mind | Convergence Fleet | Active wave coordination (cand-17 to cand-24) | Active |
| `orchestrator-infrastructure` | Gen 2 (cand-infra) | `src/infrastructure/` | Container pool, workspace hydration, telemetry scribe | Sealed |
| `orchestrator-providers` | Gen 2 (cand-prov) | `src/providers/` | Anthropic, Gemini, OpenAI adapters and pricing | Sealed |
| `orchestrator-runner` | Gen 3 (cand-run) | `src/runner/` | Execution loop, tool dispatcher, matrix runner | Sealed |
| `orchestrator-scenarios` | Gen 3 (cand-scen) | `scenarios/` | Phase 1 benchmark scenarios and catalog | Sealed |
| `orchestrator-eval` | Gen 3 (cand-eval) | `src/eval/` | Multi-stage deterministic evidence and composite validation | Sealed |
| `orchestrator-reporting` | Gen 4 (cand-rep) | `src/reporting/` | SQLite database, HTML dashboard, leaderboard | Sealed |
| `orchestrator-cli` | Gen 5 (cand-cli) | `src/cli/`, `bin/` | Universal CLI binary and subcommands | Sealed |
| `orchestrator-sweep` | Gen 5 (cand-sweep) | `src/sweep/` | Parallel matrix sweep and token-bucket limiter | Sealed |
| `orchestrator-replay` | Gen 6 (cand-rep) | `src/replay/` | ANSI TUI player, web player, scrubber | Sealed |
| `orchestrator-ci` | Gen 6 (cand-ci) | `src/ci/` | CI/CD bot, regression detector, PR commenter | Sealed |
| `orchestrator-scenarios-advanced`| Gen 6 (cand-adv) | `scenarios/` | Composite, security, and optimization scenarios | Sealed |
| `orchestrator-server` | Gen 7 (cand-srv) | `src/server/` | Native HTTP/SSE server and REST API | Sealed |
| `orchestrator-trials` | Gen 7 (cand-tri) | `data/` | Benchmark trial execution and golden dataset | Sealed |
| `orchestrator-generator` | Gen 7 (cand-10) | `src/generator/` | Autonomous scenario synthesizer | Sealed |
| `orchestrator-dashboard-ui` | Gen 7 (cand-8) | `src/dashboard-ui/` | Client SPA dashboard components | Sealed |
| `orchestrator-arena` | Gen 8 (cand-9) | `src/arena/` | Unranked arena diagnostics and jury-insufficiency arbitration | Sealed |
| `orchestrator-analytics` | Gen 8 (cand-13) | `src/analytics/` | Semantic trajectory analyzer, failure classifier | Sealed |
| `orchestrator-tunnel` | Gen 8 (cand-tun) | `src/tunnel/` | Live PTY terminal streaming and multiplexer | Sealed |
| `orchestrator-chaos` | Gen 8 (cand-12) | `src/chaos/` | Docker fault injection and chaos orchestrator | Sealed |
| `orchestrator-optimizer` | Gen 8 (cand-15) | `src/optimizer/` | Dynamic token/latency budget controller | Sealed |
| `orchestrator-streaming` | Gen 8 (cand-16) | `src/streaming/` | HTML5 Canvas visualizer and SSE broadcaster | Sealed |
| `orchestrator-skills` | Gen 9 (cand-17) | `src/skills/` | Canonical skill registry (29 skills, 7 domains) | Sealed |
| `orchestrator-interactive` | Gen 9 (cand-18) | `src/dialog/` | Interactive dialog evaluator, persona simulator | Sealed |
| `orchestrator-testbed` | Gen 9 (cand-19) | `testbed/` | Polyglot target testbed (Frontend, Backend, Go) | Sealed |
| `orchestrator-architecture-docs`| Gen 9 (cand-20) | `docs/architecture/` | Architecture specs (01-08) and design docs | Sealed |
| `orchestrator-usage-guide` | Gen 9 (cand-21) | `docs/usage-guide/` | Comprehensive human usage guide (01-07) | Sealed |
| `orchestrator-readme` | Gen 9 (cand-22) | `README.md` | Root project README with diagrams and matrix | Sealed |
| `orchestrator-neobrutalist` | Gen 9 (cand-23) | `src/reporting/` | Dark neo-brutalist visual design overhaul | Sealed |
| `orchestrator-roadmap` | Gen 9 (cand-24) | `docs/planning/` | Master roadmap and session continuity blueprint | Active |

---

## Section 2: Generation 9 Active Wave Fleet Breakdown

Generation 9 represents the Convergence & Usability Wave of the `skill-benchmarks` platform. This wave focused on canonical skills ingestion, interactive dialogue evaluation, polyglot target testbeds, comprehensive technical documentation, end-user usage guides, root project branding, and deterministic session continuity.

```
========================================================================================
                       GENERATION 9 CONVERGENCE & USABILITY WAVE
========================================================================================

  [cand-17] orchestrator-skills          --> Canonical 29-Skill Registry & Downloader
  [cand-18] orchestrator-interactive     --> Multi-Turn Conversational Dialog Evaluator
  [cand-19] orchestrator-testbed         --> Polyglot Benchmark Target Testbed Suite
  [cand-20] orchestrator-architecture-docs -> Deep Technical Architecture Specifications
  [cand-21] orchestrator-usage-guide     --> Human Operator & End-User Usage Guide
  [cand-22] orchestrator-readme          --> Root Project README & Benchmark Visuals
  [cand-23] orchestrator-neobrutalist    --> Dark Neo-Brutalist Visual Design Overhaul
  [cand-24] orchestrator-roadmap         --> Master Roadmap & Session Continuity Blueprint
```

### 2.1 Candidate Breakdown & Deliverables

#### cand-17: Canonical Skills Master Registry (`orchestrator-skills`)
- **Scope**: `src/skills/` (9 files, 2,035 LOC)
- **Deliverables**: Canonical metadata definitions for all 29 skills.sh skills across 7 domains (`devops-cloud`, `frontend-ui`, `backend-api`, `database-storage`, `security-compliance`, `data-ml`, `workflow-automation`), catalog parser, skill downloader, canonical sync scripts.
- **Key Modules**: `registry.ts`, `canonical.ts`, `catalog-parser.ts`, `downloader.ts`, `validator.ts`, `formatter.ts`.

#### cand-18: Interactive Dialog Evaluator (`orchestrator-interactive`)
- **Scope**: `src/dialog/` (4 files, 985 LOC)
- **Deliverables**: Multi-turn conversational evaluation pipeline for interactive coding skills, dynamic stakeholder persona simulator (technical, product, executive), interview evaluator, conversation transcript state machine.
- **Key Modules**: `stakeholder-simulator.ts`, `interview-evaluator.ts`, `types.ts`, `index.ts`.

#### cand-19: Polyglot Target Testbed Suite (`orchestrator-testbed`)
- **Scope**: `testbed/` (Frontend, Backend, Microservice, CLI, Docs, Scripts)
- **Deliverables**: Realistic target software repositories with intentional flaws for benchmark skill testing:
  - `testbed/frontend/`: React 19 UI with accessibility defects (missing ARIA, low contrast), hydration bugs, and CSS grid overflow.
  - `testbed/backend/`: FastAPI Python backend with SQL injection vulnerabilities, missing authentication middleware, and unindexed database queries.
  - `testbed/microservice/`: Go 1.22 microservice with goroutine leaks, data race conditions, and unbuffered channel deadlocks.
  - `testbed/cli/`: Rust / Node CLI utility with broken argument parsing and unhandled panics.
  - `testbed/docs/`: Inconsistent API documentation and broken code snippets.

#### cand-20: Technical Architecture Specifications (`orchestrator-architecture-docs`)
- **Scope**: `docs/architecture/` (8 authoritative markdown specifications)
- **Deliverables**:
  - `01-system-overview.md`: High-level topology, concurrency math ($P = W/S$), and subsystem interactions.
  - `02-container-sandbox.md`: Docker daemon integration, pool pre-warming, volume mount strategy, and cgroups v2 quotas.
  - `03-provider-adapters.md`: Frontier LLM provider normalization, rate limiting, and pricing engines.
  - `04-runner-and-interceptor.md`: Execution loop, tool virtualization, and sandbox interceptors.
  - `05-dual-layer-evaluation.md`: deterministic evidence, composite validation, and benchmark authority.
  - `06-telemetry-and-reporting.md`: SQLite event recording, authority-validated cohorts, and report publication.
  - `07-fuzzing-and-chaos.md`: container fault injection and diagnostic observations.
  - `08-binary-terminal-streaming.md`: 16-byte binary framing, WebSocket streaming, and PTY multiplexing.

#### cand-21: Human Operator Usage Guide (`orchestrator-usage-guide`)
- **Scope**: `docs/usage-guide/` (7 comprehensive guides)
- **Deliverables**: Operator documentation covering installation, configuration, CLI subcommands, single and matrix runs, replay, streaming, unranked arena diagnostics, and custom scenario authoring.

#### cand-22: Root Project Documentation (`orchestrator-readme`)
- **Scope**: `README.md`
- **Deliverables**: High-impact root documentation featuring ASCII architecture diagrams, quickstart instructions, full CLI subcommands table, pre-computed benchmark leaderboards, 22-subsystem matrix, and design philosophy.

#### cand-23: Dark Neo-Brutalist Visual Design Overhaul (`orchestrator-neobrutalist`)
- **Scope**: `src/reporting/html-dashboard.ts`, `src/dashboard-ui/`, SVG telemetry charts
- **Deliverables**: High-contrast, dark true-black (`#000000`) and crisp white (`#FFFFFF`) monochrome aesthetic with bold borders (`3px solid #000000`), sharp square corners (`border-radius: 0px`), stark elevation drop shadows (`4px 4px 0px #000000`), monospace typography, and responsive layouts across desktop, tablet, and mobile.

#### cand-24: Master Roadmap & Session Continuity Blueprint (`orchestrator-roadmap`)
- **Scope**: `docs/planning/MASTER-ROADMAP-AND-CONTINUITY.md`
- **Deliverables**: Definitive repository roadmap, complete subsystem inventory, Generation 9 fleet audit, 4-stage live execution plan, and zero-friction session resumption playbook.

---

## Section 3: Deterministic Future Roadmap to Live Execution

The roadmap to full-scale autonomous live execution proceeds in four deterministic, sequential stages.

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                           DETERMINISTIC 4-STAGE ROADMAP                               │
└───────────────────────────────────┬───────────────────────────────────────────────────┘
                                    │
 ┌──────────────────────────────────▼───────────────────────────────────┐
 │ STAGE 1: Core Subsystem Convergence & Unified Integration Pipeline   │
 │ • Unified scenario execution loop with all 22 modules wired          │
 │ • End-to-end telemetry pipeline from container to SQLite and web UI  │
 └──────────────────────────────────┬───────────────────────────────────┘
                                    │
 ┌──────────────────────────────────▼───────────────────────────────────┐
 │ STAGE 2: Testbed Suite Validation & Polyglot Defect Harnessing       │
 │ • Containerized build & test suites for frontend, backend, Go testbed│
 │ • Golden ground-truth verification scripts for all defect classes    │
 └──────────────────────────────────┬───────────────────────────────────┘
                                    │
 ┌──────────────────────────────────▼───────────────────────────────────┐
 │ STAGE 3: Canonical Scenario Coverage Expansion (All 29 Skills)       │
 │ • 29 dedicated benchmark scenarios covering all canonical skills.sh  │
 │ • Deterministic admitted scenario coverage and edge cases            │
 └──────────────────────────────────┬───────────────────────────────────┘
                                    │
 ┌──────────────────────────────────▼───────────────────────────────────┐
 │ STAGE 4: Production Readiness, Live Frontier Sweeps & Continuous CI  │
 │ • Parallel multi-provider sweeps (Claude 3.7, GPT-4.5, Gemini 2.0)  │
 │ • Automated CI/CD regression bots, PR comment leaderboards, streaming│
 └──────────────────────────────────────────────────────────────────────┘
```

### Stage 1: Core Subsystem Convergence & Unified Integration Pipeline
- **Goal**: Seamlessly wire all 22 delivered `src/` subsystems into a single executable orchestration loop.
- **Key Milestones**:
  1. *Subsystem Interop Contract*: Ensure `src/runner`, `src/eval`, `src/chaos`, `src/optimizer`, and `src/tunnel` execute in a coordinated pipeline during single trial and matrix runs.
  2. *Live Telemetry Streaming*: Connect `src/streaming/canvas-streamer.ts` and `src/tunnel/stream-tunnel.ts` to `src/server/http-server.ts` for live real-time web visualization during benchmark runs.
  3. *Dynamic Budget Feedback*: Wire `src/optimizer/budget-controller.ts` directly into `src/runner/context-manager.ts` to dynamically throttle context consumption and switch model tiers based on real-time token spend.
- **Verification Gate**: `bun run src/scripts/quality-gate.ts` + dry-run matrix execution of all 12 existing scenarios.

### Stage 2: Testbed Suite Validation & Polyglot Defect Harnessing
- **Goal**: Verify and validate the bundled polyglot testbed in `testbed/` with automated Docker build environments and ground-truth validation scripts.
- **Key Milestones**:
  1. *Dockerized Testbed Images*: Build lightweight Docker base images for Node 22 (React frontend), Python 3.12 (FastAPI backend), Go 1.22 (microservice), and Rust 1.80 (CLI).
  2. *Ground-Truth Defect Assertions*: Implement automated validation gates verifying the presence and precise resolution of all intentional defects (ARIA tags, SQLi, goroutine leaks, unindexed queries).
  3. *Workspace Snapshot Fingerprinting*: Validate that `src/infrastructure/workspace/fingerprint.ts` computes identical SHA-256 tree hashes across repeated pristine testbed hydrations.
- **Verification Gate**: `bun run typecheck` + automated verification of testbed build artifacts and test suites.

### Stage 3: Canonical Scenario Coverage Expansion (All 29 Skills)
- **Goal**: Author dedicated benchmark scenarios covering 100% of the 29 canonical skills across all 7 functional categories.
- **Key Milestones**:
  1. *Domain Expansion Matrix*:
     - `devops-cloud` (4 skills): `docker-build-push`, `kubernetes-deploy`, `terraform-provision`, `github-actions-ci`.
     - `frontend-ui` (4 skills): `react-accessibility`, `tailwind-styling`, `nextjs-ssr`, `vue-state-management`.
     - `backend-api` (5 skills): `fastapi-auth`, `express-rest`, `graphql-schema`, `grpc-service`, `django-orm`.
     - `database-storage` (4 skills): `postgres-indexing`, `redis-cache`, `mongodb-aggregation`, `prisma-migration`.
     - `security-compliance` (4 skills): `owasp-audit`, `jwt-validation`, `cors-headers`, `secret-scanning`.
     - `data-ml` (4 skills): `pandas-pipeline`, `sklearn-model`, `sql-analytics`, `data-visualization`.
     - `workflow-automation` (4 skills): `cron-scheduling`, `webhook-dispatcher`, `slack-bot`, `email-notifications`.
  2. *Adversarial Coverage*: Admit explicit scenario fixtures and execute them through the common runner and evaluator authority.
- **Verification Gate**: `bun run src/scripts/verify-scenarios.ts` verifying scenario structure, step definitions, and verification gates.

### Stage 4: Production Readiness, Live Frontier Sweeps & Continuous CI
- **Goal**: Execute full-scale live benchmark sweeps with frontier LLM API keys and establish continuous automated leaderboard tracking.
- **Key Milestones**:
  1. *Frontier Model Matrix Sweeps*: Execute sweeps across Anthropic Claude (3.5 Sonnet, 3.7 Sonnet), OpenAI (GPT-4o, GPT-4.5), and Google Gemini (1.5 Pro, 2.0 Flash) using `skill-benchmarks sweep --matrix`.
  2. *Continuous Leaderboard Deployment*: Publish operator-requested leaderboard and dashboard exports only from eligible benchmark evidence.
  3. *GitHub Actions Smoke Gate*: Execute a canonical no-key run and retain its diagnostic evidence without publishing regression claims.
- **Verification Gate**: Production run completion with an output-root SQLite database, eligible evidence-backed leaderboards, and zero regression alerts.

---

## Section 4: Deterministic Handoff & Session Resumption Playbook

This playbook provides step-by-step instructions for ANY future AI agent, Mind, or human operator to seamlessly inspect repository state, verify invariants, and resume execution without friction or lost context.

### 4.1 Step-by-Step Session Resumption Workflow

```
┌────────────────────────────────────────────────────────────────────────┐
│                   SESSION RESUMPTION PROTOCOL                          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
 ┌──────────────────────────────────▼────────────────────────────────────┐
 │ STEP 1: Git & Working Directory Cleanliness Check                     │
 │ $ git status --porcelain                                              │
 │ $ git log -n 5 --oneline                                              │
 └──────────────────────────────────┬────────────────────────────────────┘
                                    │
 ┌──────────────────────────────────▼────────────────────────────────────┐
 │ STEP 2: OLT Harness & Lockfile State Inspection                       │
 │ $ ls -la .olt/capsules/.locks/                                        │
 │ $ bun ~/.agents/skills/olt/scripts/harness.ts mind:pulse              │
 └──────────────────────────────────┬────────────────────────────────────┘
                                    │
 ┌──────────────────────────────────▼────────────────────────────────────┐
 │ STEP 3: Quality Gate & Typecheck Verification                         │
 │ $ bun run typecheck                                                   │
 │ $ bun run src/scripts/quality-gate.ts                                 │
 └──────────────────────────────────┬────────────────────────────────────┘
                                    │
 ┌──────────────────────────────────▼────────────────────────────────────┐
 │ STEP 4: Inspect Capsule DAG & Task Queue                              │
 │ $ bun ~/.agents/skills/olt/scripts/harness.ts queue:list --run <run>  │
 │ $ bun ~/.agents/skills/olt/scripts/harness.ts run:status --run <run>  │
 └──────────────────────────────────┬────────────────────────────────────┘
                                    │
 ┌──────────────────────────────────▼────────────────────────────────────┐
 │ STEP 5: Claim / Validate Tasks or Seal Run                            │
 │ $ bun harness.ts task:claim / task:submit / task:review / run:complete│
 └───────────────────────────────────────────────────────────────────────┘
```

#### Step 1: Inspect Git & Working Tree
Always verify current working branch and uncommitted modifications:
```bash
git status
git log -n 5 --oneline
```
Ensure you are on `main` and working tree is clean or properly staged.

#### Step 2: Inspect OLT Harness Locks and Active Capsules
Check for active or stale locks:
```bash
ls -la .olt/capsules/.locks/
```
If a stale lock exists from an interrupted session, inspect the capsule's `state.json` and clear the lock if the holding process is inactive.

#### Step 3: Run Baseline Quality Gate & Typecheck
Ensure that all code changes meet repository invariants prior to authoring any new files:
```bash
bun run typecheck
bun run src/scripts/quality-gate.ts
```
Expected output: `✅ Quality Gate Passed: All source files verified (0 comments, <= 400 lines).`

#### Step 4: Inspect Capsule Status & Ready Queue
To check the status of any specific capsule (e.g., `orchestrator-roadmap`):
```bash
bun ~/.agents/skills/olt/scripts/harness.ts run:status --run .olt/capsules/<CAPSULE_NAME>
bun ~/.agents/skills/olt/scripts/harness.ts queue:list --run .olt/capsules/<CAPSULE_NAME>
```

#### Step 5: Execute or Resume Task Lifecycle
1. **Claim Task**:
   ```bash
   bun ~/.agents/skills/olt/scripts/harness.ts task:claim --run .olt/capsules/<RUN_ID> --task <TASK_ID> --agent <AGENT_ID> --role implementer
   ```
2. **Implement Deliverables**: Confine all modifications strictly to the assigned write scope. Zero comments, `<= 400` LOC per file.
3. **Verify Locally**:
   ```bash
   bun run typecheck
   bun run src/scripts/quality-gate.ts
   ```
4. **Submit Task**:
   ```bash
   bun ~/.agents/skills/olt/scripts/harness.ts task:submit --run .olt/capsules/<RUN_ID> --task <TASK_ID> --agent <AGENT_ID> --token <LEASE_TOKEN> --summary "<SUMMARY>"
   ```
5. **Start Validation & Review**:
   ```bash
   bun ~/.agents/skills/olt/scripts/harness.ts task:validate-start --run .olt/capsules/<RUN_ID> --task <TASK_ID> --validator <VALIDATOR_ID>
   bun ~/.agents/skills/olt/scripts/harness.ts task:review --run .olt/capsules/<RUN_ID> --task <TASK_ID> --validator <VALIDATOR_ID> --token <VAL_TOKEN> --decision pass --summary "Validated"
   ```
6. **Seal Capsule**:
   ```bash
   bun ~/.agents/skills/olt/scripts/harness.ts run:complete --run .olt/capsules/<RUN_ID> --actor <ACTOR_ID>
   ```

#### Step 6: Atomic Git Commit & Push Protocol
Once the capsule is sealed and verification gates pass:
```bash
git add <MODIFIED_DELIVERABLES>
git commit -m "<conventional commit message <= 70 chars>"
git push origin main
```

---

### 4.2 Troubleshooting & Failure Recovery Matrix

| Symptom / Error | Root Cause | Immediate Recovery Action |
| :--- | :--- | :--- |
| `LOCK_TIMEOUT` (exit code 4) | A previous process crashed while holding a lock file in `.olt/capsules/.locks/`. | Run `rm -rf .olt/capsules/.locks/<CAPSULE_NAME>*` and retry the harness command. |
| `LEASE_EXPIRED` on task submit | The implementer lease exceeded the 1200-second timeout window. | Claim a new lease on the task with `task:claim` and submit with the new bearer token. |
| `FORBIDDEN_COMMENT` in Quality Gate | Source file contains `//`, `/* */`, or JSDoc comments. | Remove all comment tokens. Ensure symbols and type definitions are self-documenting. |
| `LINE_COUNT_EXCEEDED` in Quality Gate | A TypeScript source file exceeds 400 lines. | Refactor module into smaller cohesive files (e.g., split into `types.ts`, `engine.ts`, `helpers.ts`). |
| Missing Required Deliverable in Gate | Quality gate expects required deliverables (e.g. `docs/architecture/*`, `README.md`, `data/*`). | Ensure all required documentation and data artifacts exist on disk before running gate. |
| `INTEGRITY: invalid gate command` | Gate command in `plan:add` used unhandled shell combinators like `&&`. | Use a single executable command (e.g., `bun src/scripts/quality-gate.ts`). |

---

## Section 5: Architecture & Invariant Reference Summary

For detailed technical specifications, refer to the following companion documents:
- **System Overview & Concurrency Model**: `docs/architecture/01-system-overview.md`
- **Container Sandbox & Isolation**: `docs/architecture/02-container-sandbox.md`
- **Frontier LLM Providers & Pricing**: `docs/architecture/03-provider-adapters.md`
- **Execution Loop & Tool Interception**: `docs/architecture/04-runner-and-interceptor.md`
- **Evidence Eligibility & Evaluation**: `docs/architecture/05-dual-layer-evaluation.md`
- **Telemetry, SQLite Database & Reporting**: `docs/architecture/06-telemetry-and-reporting.md`
- **Chaos Fault Injection**: `docs/architecture/07-fuzzing-and-chaos.md`
- **PTY Terminal & Binary Streaming Tunnel**: `docs/architecture/08-binary-terminal-streaming.md`
- **Operator & Human Usage Guide**: `docs/usage-guide/README.md`
- **Canonical Skill Registry**: `src/skills/registry.ts`

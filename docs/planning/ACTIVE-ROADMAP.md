# Active Product Vision & Continuous Expansion Roadmap

This document outlines the strategic product vision, future capability expansions, and continuous improvement lanes for the **Skill-Benchmarks** framework.

---

## 🎯 Strategic Product Goals

```
+==================================================================================================+
|                                    PRODUCT ROADMAP LANES                                         |
+==================================================================================================+
|  Lane 1: Zero-Friction Mock/Live Provider Switch (Instant Offline & Live Frontier Execution)     |
|  Lane 2: 100% Skill Coverage (All 29 Skills in skill-list.md Implemented as Benchmarks) [100%]  |
|  Lane 3: High-Density Interactive Terminal TUI & Live ASCII Replay Scrubber [SHIPPED]           |
|  Lane 4: Side-by-Side Admitted Pairing Plans and Unranked Candidate Diagnostics [SHIPPED]         |
|  Lane 5: Standalone Shareable HTML/SVG Neo-Brutalist Report Card & Trajectory Diff Viewer [SHIPPED]
+==================================================================================================+
```

---

## 🚀 Active Feature Expansion Queue

### 1. 100% Complete Scenario Catalog Coverage (`scenarios/`)
- ✅ **100% Complete Skill Catalog (29 / 29 Scenarios Implemented & Verified)**:
  1. `git-worktrees` (`using-git-worktrees` / `caveman-commit`)
  2. `a11y-audit` (`a11y-debugging` / `frontend-design` / `qa` / `webapp-testing` / `playwright-best-practices`)
  3. `composition-patterns` (`vercel-composition-patterns` / `improve-codebase-architecture`)
  4. `memory-leak` (`memory-leak-debugging` / `azure-messaging` / `safe-debug`)
  5. `golang-concurrency` (`golang-pro` / `golang-troubleshooting` / `golang-documentation`)
  6. `fullstack-refactor` (`fullstack-refactor` / `grill-me` / `grill-with-docs` / `tdd` / `create-readme` / `documentation-and-adrs` / `readme-blueprint-generator` / `code-review` / `code-review-excellence` / `code-review-and-quality` / `code-reviewer` / `azure-deploy` / `request-refactor-plan` / `mcp-builder` / `api-design-principles`)
  7. `polyglot-sanitization` (`security-triage` / `firebase-security-rules-auditor` / `skill-vetter` / `security-review` / `pci-compliance` / `pdf`)
  8. `zero-alloc-pipeline` (`performance-optimization` / `supabase-postgres-best-practices` / `just-scrape` / `convex-performance-audit`)
  9. `azure-diagnostics` (`azure-diagnostics`)
  10. `playwright-cli` (`playwright-cli`)
  11. `azure-compliance` (`azure-compliance`)
  12. `documentation-writer` (`documentation-writer`)
  13. `systematic-debugging` (`diagnosing-bugs`)
  14. `chrome-extensions` (`chrome-extensions`)
  15. `css-animations` (`css-animations`)
  16. `debug-optimize-lcp` (`debug-optimize-lcp`)
  17. `modern-web-guidance` (`modern-web-guidance`)
  18. `sq` (`sq`)
  19. `google-antigravity-sdk` (`google-antigravity-sdk`)
  20. `api-design-principles` (`api-design-principles`)
  21. `mcp-builder` (`mcp-builder`)
  22. `convex-performance-audit` (`convex-performance-audit`)
  23. `vercel-react-view-transitions` (`vercel-react-view-transitions`)
  24. `request-refactor-plan` (`request-refactor-plan`)
  25. `firebase-security-rules-auditor` (`firebase-security-rules-auditor`)
  26. `skill-vetter` (`skill-vetter`)
  27. `security-review` (`security-review`)
  28. `pci-compliance` (`pci-compliance`)
  29. `agent-browser` (`agent-browser`)

### 2. Evidence-Bound Report Dashboard, Replay & REPL HUD (`src/reporting/`, `src/replay/`, `src/tui/`)
- ✅ **Persisted Trajectory Diff Viewer**: Replay exposes only workspace mutations loaded from the canonical persisted event stream.
- ✅ **Standalone Shareable Report Card & Badge Exporter**: Authored `src/reporting/report-card.ts` with `--export-card <svg|html>` CLI flag for generating embeddable SVG badges and self-contained HTML report cards for GitHub READMEs.
- ✅ **Accessible HTML Evidence Reader**: The report dashboard and replay player use labeled controls, keyboard navigation, semantic charts, responsive layouts, and persisted evidence only.
- ✅ **Read-Only Local Server**: The loopback reader exposes report and replay resources from one existing authority-bound database without CORS, telemetry writes, or streaming mutation routes.
- ✅ **Terminal TUI Scrubber**: Terminal replay navigates the same persisted frames without manufacturing missing evidence.

### 3. Zero-Friction Provider Engine (`src/providers/`)
- ✅ **Default Offline Mock Mode**: Run validation sweeps and unranked candidate diagnostics without provider requests or benchmark-quality claims.
- ✅ **Multi-Thinking Matrix Sweeps**: Full support for `--matrix-thinking none,low,medium,high,max`, `--dry-run`, and `--category` filtering.
- **Live API Transition**: Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` (or toggle `--live` / `SKILL_BENCHMARKS_MOCK=false`) to execute live inference against Claude 3.7 Sonnet, OpenAI o3-mini/o1, and Gemini 2.0 Pro.

### 4. Side-by-Side Arena Diagnostics (`src/runner/arena-runner.ts`, `src/arena/`)
- ✅ **Deterministic Planning**: Dry arena validates explicit selectors and emits a pairing without provider, workspace, database, or judge work.
- ✅ **Unranked Fake Execution**: Mock arena routes candidates through the common sweep and exposes only simulated operational provenance.
- ⏳ **Ranked Comparison**: Winner, judge, confidence, and rating behavior remains unavailable until durable comparable evidence exists.

### 5. Multi-Model Tournament Planner (`src/runner/tournament-scheduler.ts`)
- ✅ **Pairing Plans**: Round-robin schedules and the first Swiss round expose pairings, capacity, and planned byes only.
- ✅ **Diagnostic Execution**: Fake pairings do not mutate points, match history, tiebreaks, ratings, standings, or ranks.
- ⏳ **Ranked Tournament**: Result-dependent Swiss rounds and standings remain unavailable until ranked arena evidence exists.

---

## 📜 Completed Plans Archive
Historical implementation plans and initial phase blueprints are preserved under `docs/archive/completed-plans/` and `docs/blueprints/`.

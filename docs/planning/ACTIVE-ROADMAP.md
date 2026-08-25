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
|  Lane 4: Side-by-Side Multi-Model Arena Battle Mode with Automated Bradley-Terry Elo Updates    |
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

### 2. High-Density Neo-Brutalist Dashboard, Report Card Exporter & REPL HUD (`src/dashboard-ui/`, `src/reporting/`, `src/tui/`)
- ✅ **Side-by-Side Trajectory Diff Viewer**: Side-by-side before/after column layout and unified diff view toggle for inspectable workspace mutations.
- ✅ **Standalone Shareable Report Card & Badge Exporter**: Authored `src/reporting/report-card.ts` with `--export-card <svg|html>` CLI flag for generating embeddable SVG badges and self-contained HTML report cards for GitHub READMEs.
- ✅ **Interactive Terminal REPL HUD & ASCII Charts**: Authored `src/tui/hud.ts` and `src/tui/ascii-charts.ts` featuring ASCII Pareto frontiers, token spend sparklines, latency distribution percentiles, and instant keybinding shortcuts.
- ✅ **Interactive SVG Chart Suite**: Token Velocity (tokens/sec curve), Latency Distribution Percentiles (P50, P90, P99, Max), and Cost-Pass Pareto Frontier.
- ✅ **Real-Time WebSocket & SSE Stream Client**: Resilient WebSocket connection to `ws://localhost:4000/tunnel` with auto-reconnection and live throughput meters (`evt/s`).
- ✅ **Terminal TUI Scrubber Upgrades**: Side-by-side terminal column diffs and instantaneous token generation velocity telemetry.

### 3. Zero-Friction Provider Engine (`src/providers/`)
- ✅ **Default Offline Mock Mode**: Run complete benchmark suites, matrix sweeps, and tournaments with high-fidelity tool execution and simulated token metrics without requiring API keys.
- ✅ **Multi-Thinking Matrix Sweeps**: Full support for `--matrix-thinking none,low,medium,high,max`, `--dry-run`, and `--category` filtering.
- **Live API Transition**: Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` (or toggle `--live` / `SKILL_BENCHMARKS_MOCK=false`) to execute live inference against Claude 3.7 Sonnet, OpenAI o3-mini/o1, and Gemini 2.0 Pro.

### 4. Arena Battle Engine (`src/arena/`)
- Run head-to-head model matches on the same scenario in isolated Docker sandboxes.
- Real-time judge consensus scoring and live leaderboard Elo re-ranking with Bradley-Terry updates.

---

## 📜 Completed Plans Archive
Historical implementation plans and initial phase blueprints are preserved under `docs/archive/completed-plans/` and `docs/blueprints/`.

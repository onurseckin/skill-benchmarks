# Active Product Vision & Continuous Expansion Roadmap

This document outlines the strategic product vision, future capability expansions, and continuous improvement lanes for the **Skill-Benchmarks** framework.

---

## 🎯 Strategic Product Goals

```
+==================================================================================================+
|                                    PRODUCT ROADMAP LANES                                         |
+==================================================================================================+
|  Lane 1: Zero-Friction Mock/Live Provider Switch (Instant Offline & Live Frontier Trial Execution)|
|  Lane 2: 100% Skill Coverage (Synthesizing Scenarios for all 29 Skills in skill-list.md)         |
|  Lane 3: High-Density Interactive Terminal TUI & Live ASCII Replay Scrubber                      |
|  Lane 4: Side-by-Side Multi-Model Arena Battle Mode with Automated Bradley-Terry Elo Updates    |
|  Lane 5: Standalone Shareable HTML/SVG Report Card Exporter                                      |
+==================================================================================================+
```

---

## 🚀 Active Feature Expansion Queue

### 1. Zero-Friction Provider Engine (`src/providers/`)
- **Default Offline Mock Mode**: Run complete benchmark suites, matrix sweeps, and tournaments with high-fidelity tool execution and simulated token metrics without requiring API keys.
- **Live API Transition**: Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` (or toggle `--live` / `SKILL_BENCHMARKS_MOCK=false`) to seamlessly execute live inference against Claude 3.7 Sonnet, OpenAI o3-mini/o1, and Gemini 2.0 Pro.

### 2. Full Scenario Catalog Expansion (Remaining Skills in `skill-list/skill-list.md`)
Expand scenario coverage from 13 to all 29 skills:
- **Frontend & Modern Web**: `chrome-extensions`, `css-animations`, `debug-optimize-lcp`, `modern-web-guidance`, `vercel-react-view-transitions`.
- **Cloud & Tooling**: `sq`, `antigravity-guide`, `google-antigravity-sdk`, `agy-customizations`.
- **Review & Design**: `requesting-code-review`, `receiving-code-review`, `stitch-design`, `react-components`.

### 3. High-Density Interactive TUI & Live Streaming
- Real-time ASCII line graphs showing token spend rate and latency percentiles.
- Interactive side-by-side terminal diff viewer for inspecting agent file modifications.

### 4. Arena Battle Engine
- Run head-to-head model matches on the same scenario in isolated Docker sandboxes.
- Real-time judge consensus scoring and live leaderboard Elo re-ranking.

---

## 📜 Completed Plans Archive
Historical implementation plans and initial phase blueprints are preserved under `docs/archive/completed-plans/` and `docs/blueprints/`.

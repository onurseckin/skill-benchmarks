import { writeFileSync } from "node:fs";
import type { AppState, SpaCompilerOptions } from "./types.js";
import { THEME_DARK, DashboardStateManager } from "./state.js";
import {
  escapeHtml,
  renderKpiCard,
  renderLeaderboardTable,
  renderNavbar,
  renderTrajectoryScrubber,
} from "./components.js";

export function generateDashboardCss(): string {
  return `
html, body, div, span, p, h1, h2, h3, h4, table, tr, th, td, button, input, select, main, header, section, nav { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: var(--font-sans); width: 100vw; min-height: 100vh; display: flex; flex-direction: column; overflow-x: hidden; }
.main-content { flex: 1; padding: 20px; width: 100%; max-width: 100%; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
.kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; font-weight: 700; font-size: 15px; color: var(--primary); }
.code-box { background: var(--bg-sec); border: 1px solid var(--border); border-radius: 6px; padding: 12px; font-family: var(--font-mono); font-size: 12px; max-height: 280px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
`.trim();
}

export function renderDashboardApp(state: AppState): string {
  const { activeView, theme, leaderboard, replay, live, runs } = state;
  const navbar = renderNavbar(activeView, theme, live.isConnected);

  const totalRuns = runs.length || leaderboard.entries.reduce((sum, e) => sum + e.totalRuns, 0);
  const avgPass = leaderboard.entries.length > 0
    ? (leaderboard.entries.reduce((sum, e) => sum + e.passRate, 0) / leaderboard.entries.length).toFixed(1)
    : "0.0";
  const topSkill = leaderboard.entries[0]?.skillId ?? "None";

  const kpiSection = `<section class="kpi-row">${renderKpiCard({ id: "total-runs", title: "Total Runs", value: totalRuns.toLocaleString() }, theme)}${renderKpiCard({ id: "top-skill", title: "Top Ranked Skill", value: topSkill }, theme)}${renderKpiCard({ id: "avg-pass", title: "Avg Pass Rate", value: `${avgPass}%` }, theme)}${renderKpiCard({ id: "live-events", title: "Live Events Streamed", value: live.receivedEventCount }, theme)}</section>`;

  let viewContent = "";
  if (activeView === "leaderboard") {
    viewContent = `<section class="panel"><div class="panel-header"><span>Skill Leaderboard &amp; Benchmark Metrics</span></div>${renderLeaderboardTable(leaderboard, theme)}</section>`;
  } else if (activeView === "replay") {
    viewContent = `<section class="panel"><div class="panel-header"><span>Interactive Trajectory Replay</span></div><div id="replay-view-content" style="min-height:300px">${replay.session ? `<div style="font-size:13px;color:${theme.textMuted};margin-bottom:12px">Loaded Run: <strong>${escapeHtml(replay.session.metadata.scenarioId)}</strong> (${escapeHtml(replay.session.metadata.skillId)})</div>` : `<div style="padding:40px;text-align:center;color:${theme.textDim}">Select a run from the leaderboard to inspect execution trajectory.</div>`}</div>${renderTrajectoryScrubber(replay, theme)}</section>`;
  } else if (activeView === "live") {
    viewContent = `<section class="panel"><div class="panel-header"><span>Real-Time Host Telemetry Stream</span><button onclick="appClearLiveBuffer()" style="background:${theme.surfaceAlt};border:1px solid ${theme.border};color:${theme.text};padding:4px 10px;border-radius:4px;font-size:12px;cursor:pointer">Clear Buffer</button></div><div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;margin-bottom:16px"><div style="background:${theme.bgSecondary};padding:12px;border-radius:6px;border:1px solid ${theme.border}"><div style="font-size:11px;color:${theme.textDim}">Peak CPU</div><div style="font-size:20px;font-weight:700;color:${theme.success};font-family:${theme.fontMono}">${live.peakCpuPercent.toFixed(1)}%</div></div><div style="background:${theme.bgSecondary};padding:12px;border-radius:6px;border:1px solid ${theme.border}"><div style="font-size:11px;color:${theme.textDim}">Peak Memory RSS</div><div style="font-size:20px;font-weight:700;color:${theme.warning};font-family:${theme.fontMono}">${live.peakMemoryMb.toFixed(1)} MB</div></div><div style="background:${theme.bgSecondary};padding:12px;border-radius:6px;border:1px solid ${theme.border}"><div style="font-size:11px;color:${theme.textDim}">Buffered Frames</div><div style="font-size:20px;font-weight:700;color:${theme.primary};font-family:${theme.fontMono}">${live.bufferedFrames.length}</div></div></div><div class="code-box" id="live-log-box">${live.bufferedFrames.length > 0 ? live.bufferedFrames.map((f, i) => `#${i + 1} [${f.eventType.toUpperCase()}] ${escapeHtml(f.summary)}`).join("\n") : "Waiting for live telemetry stream..."}</div></section>`;
  } else {
    viewContent = `<section class="panel"><div class="panel-header"><span>Analytics &amp; System Overview</span></div><p style="color:${theme.textMuted};font-size:13px">Aggregate run summaries and historical model comparison metrics.</p></section>`;
  }

  return `${navbar}<main class="main-content">${kpiSection}${viewContent}</main>`;
}

export function generateStandaloneSpaHtml(options: SpaCompilerOptions = {}): string {
  const manager = new DashboardStateManager(options);
  const state = manager.getState();
  const title = escapeHtml(options.title ?? "Skill Benchmarks Dashboard");
  const css = generateDashboardCss();
  const initialHtml = renderDashboardApp(state);
  const dataJson = JSON.stringify(options.embeddedData ?? {}).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

  const clientScript = `
(function() {
  var embedded = JSON.parse(document.getElementById('embedded-data').textContent || '{}');
  var currentView = '${state.activeView}';
  var currentTheme = '${state.themeMode}';
  var isPlaying = false;
  var timer = null;

  window.appSetView = function(view) {
    currentView = view;
    var params = new URLSearchParams(window.location.search);
    params.set('view', view);
    window.history.replaceState({}, '', window.location.pathname + '?' + params.toString());
    window.location.reload();
  };

  window.appSetTheme = function(mode) {
    currentTheme = mode;
    var params = new URLSearchParams(window.location.search);
    params.set('theme', mode);
    window.history.replaceState({}, '', window.location.pathname + '?' + params.toString());
    window.location.reload();
  };

  window.appFilterCategory = function(cat) {
    var rows = document.querySelectorAll('tbody tr');
    rows.forEach(function(r) {
      var catCell = r.children[2];
      if (!catCell) return;
      var text = catCell.textContent.trim();
      r.style.display = (cat === 'all' || text === cat) ? '' : 'none';
    });
  };

  window.appSearchLeaderboard = function(query) {
    var q = query.toLowerCase().trim();
    var rows = document.querySelectorAll('tbody tr');
    rows.forEach(function(r) {
      var text = r.textContent.toLowerCase();
      r.style.display = (!q || text.indexOf(q) !== -1) ? '' : 'none';
    });
  };

  window.appSortLeaderboard = function(colKey) {
    var table = document.querySelector('table');
    if (!table) return;
    var tbody = table.querySelector('tbody');
    var rows = Array.from(tbody.querySelectorAll('tr'));
    rows.reverse();
    rows.forEach(function(r) { tbody.appendChild(r); });
  };

  window.appSelectSkill = function(skillId) {
    window.appSetView('replay');
  };

  window.appTogglePlay = function() {
    isPlaying = !isPlaying;
    var btn = document.querySelector('.scrubber-bar button');
    if (btn) btn.textContent = isPlaying ? 'Pause' : 'Play';
  };

  window.appStepFrame = function(delta) {
    var slider = document.querySelector('.scrubber-bar input[type=range]');
    if (slider) {
      slider.value = Math.max(0, parseInt(slider.value, 10) + delta);
    }
  };

  window.appSeekFrame = function(idx) {};
  window.appSetPlaybackSpeed = function(spd) {};
  window.appClearLiveBuffer = function() {
    var box = document.getElementById('live-log-box');
    if (box) box.textContent = 'Buffer cleared. Waiting for telemetry...';
  };

  try {
    var es = new EventSource('/api/sse');
    es.onmessage = function(ev) {
      try {
        var d = JSON.parse(ev.data);
        var box = document.getElementById('live-log-box');
        if (box) {
          box.textContent = JSON.stringify(d, null, 2) + '\\n\\n' + box.textContent.slice(0, 2000);
        }
      } catch (err) {}
    };
  } catch (err) {}
})();
`.trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
  <style>
    :root {
      --bg: ${state.theme.bg};
      --bg-sec: ${state.theme.bgSecondary};
      --surface: ${state.theme.surface};
      --surface-alt: ${state.theme.surfaceAlt};
      --border: ${state.theme.border};
      --border-strong: ${state.theme.borderStrong};
      --text: ${state.theme.text};
      --text-muted: ${state.theme.textMuted};
      --text-dim: ${state.theme.textDim};
      --primary: ${state.theme.primary};
      --primary-alpha: ${state.theme.primaryAlpha};
      --success: ${state.theme.success};
      --warning: ${state.theme.warning};
      --error: ${state.theme.error};
      --font-mono: ${state.theme.fontMono};
      --font-sans: ${state.theme.fontSans};
    }
    ${css}
  </style>
</head>
<body>
  <div id="app-root">${initialHtml}</div>
  <script type="application/json" id="embedded-data">${dataJson}</script>
  <script>${clientScript}</script>
</body>
</html>`;
}

export function exportDashboardSpa(outputPath: string, options: SpaCompilerOptions = {}): void {
  const html = generateStandaloneSpaHtml(options);
  writeFileSync(outputPath, html, "utf8");
}

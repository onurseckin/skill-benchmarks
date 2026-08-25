import { writeFileSync } from "node:fs";
import type { AppState, DiffViewModel, SpaCompilerOptions } from "./types.js";
import { THEME_DARK, DashboardStateManager } from "./state.js";
import {
  escapeHtml,
  renderKpiCard,
  renderLeaderboardTable,
  renderNavbar,
  renderTrajectoryScrubber,
} from "./components.js";
import { parseRawDiffToSideBySide, renderInteractiveDiffViewer } from "./diff-viewer.js";
import { renderLatencyPercentilesSvg, renderTokenVelocityChartSvg } from "./charts.js";

export function generateDashboardCss(): string {
  return `
html, body, div, span, p, h1, h2, h3, h4, table, tr, th, td, button, input, select, main, header, section, nav { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #000000; color: #ffffff; font-family: "JetBrains Mono", "Fira Code", monospace; width: 100vw; min-height: 100vh; display: flex; flex-direction: column; overflow-x: hidden; }
.main-content { flex: 1; padding: 20px; width: 100%; max-width: 100%; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
.kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.panel { background: #000000; border: 2px solid #ffffff; border-radius: 0px; box-shadow: 4px 4px 0px #ffffff; padding: 20px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; font-weight: 900; font-size: 14px; color: #ffffff; text-transform: uppercase; letter-spacing: 1px; }
.code-box { background: #0a0a0a; border: 2px solid #ffffff; border-radius: 0px; padding: 14px; font-family: "JetBrains Mono", monospace; font-size: 11px; max-height: 320px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; color: #ffffff; line-height: 1.4; box-shadow: 2px 2px 0px #ffffff; }
.btn-neo { background: #000000; border: 2px solid #ffffff; color: #ffffff; padding: 6px 12px; font-family: "JetBrains Mono", monospace; font-size: 11px; font-weight: 800; cursor: pointer; text-transform: uppercase; box-shadow: 2px 2px 0px #ffffff; }
.btn-neo:hover { background: #ffffff; color: #000000; }
.charts-grid-neo { display: grid; grid-template-columns: repeat(auto-fit, minmax(440px, 1fr)); gap: 16px; }
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
    const mockDiff: DiffViewModel = replay.session?.frames.find((f) => f.diff)?.diff
      ? parseRawDiffToSideBySide(
          replay.session.frames.find((f) => f.diff)!.diff!.path,
          replay.session.frames.find((f) => f.diff)!.diff!.diffHunk || "--- a/file\n+++ b/file\n@@ -1,2 +1,3 @@\n context\n-old line\n+new line\n+added line",
          replay.session.frames.find((f) => f.diff)!.diff!.changeType
        )
      : parseRawDiffToSideBySide("src/index.ts", "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -10,4 +10,6 @@\n export function executeTask() {\n-  return false;\n+  const verified = true;\n+  return verified;\n }");

    const diffViewerHtml = renderInteractiveDiffViewer(mockDiff, "split", theme);

    viewContent = `<section class="panel"><div class="panel-header"><span>Interactive Trajectory Replay &amp; Diff Inspector</span></div><div id="replay-view-content" style="display:flex;flex-direction:column;gap:16px;margin-bottom:16px">${replay.session ? `<div style="font-size:12px;color:#aaaaaa">Loaded Run: <strong style="color:#ffffff">${escapeHtml(replay.session.metadata.scenarioId)}</strong> (${escapeHtml(replay.session.metadata.skillId)})</div>` : `<div style="padding:16px;background:#050505;border:1px solid #333333;color:#888888;font-size:12px">Select a run from the leaderboard or review default trajectory frame mutations below.</div>`}${diffViewerHtml}</div>${renderTrajectoryScrubber(replay, theme)}</section>`;
  } else if (activeView === "live") {
    viewContent = `<section class="panel"><div class="panel-header"><span>Real-Time WebSocket &amp; SSE Telemetry Stream</span><div style="display:flex;gap:8px"><button onclick="appReconnectWs()" class="btn-neo">RECONNECT WS</button><button onclick="appClearLiveBuffer()" class="btn-neo">CLEAR BUFFER</button></div></div><div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;margin-bottom:16px"><div class="panel" style="padding:12px"><div style="font-size:10px;color:#888888;font-weight:700">PEAK CPU %</div><div style="font-size:24px;font-weight:900;color:#ffffff">${live.peakCpuPercent.toFixed(1)}%</div></div><div class="panel" style="padding:12px"><div style="font-size:10px;color:#888888;font-weight:700">PEAK MEMORY RSS</div><div style="font-size:24px;font-weight:900;color:#ffffff">${live.peakMemoryMb.toFixed(1)} MB</div></div><div class="panel" style="padding:12px"><div style="font-size:10px;color:#888888;font-weight:700">STREAMED FRAMES</div><div style="font-size:24px;font-weight:900;color:#ffffff" id="live-frame-count">${live.bufferedFrames.length}</div></div><div class="panel" style="padding:12px"><div style="font-size:10px;color:#888888;font-weight:700">THROUGHPUT</div><div style="font-size:24px;font-weight:900;color:#ffffff" id="live-fps-meter">0.0 evt/s</div></div></div><div class="code-box" id="live-log-box">${live.bufferedFrames.length > 0 ? live.bufferedFrames.map((f, i) => `#${i + 1} [${f.eventType.toUpperCase()}] ${escapeHtml(f.summary)}`).join("\n") : "Waiting for live WebSocket/SSE telemetry stream on ws://localhost:4000/tunnel and /api/sse..."}</div></section>`;
  } else {
    const mockVelPoints = [
      { turn: 1, elapsedMs: 800, tokensPerSec: 42, cumulativeTokens: 42 },
      { turn: 2, elapsedMs: 1600, tokensPerSec: 88, cumulativeTokens: 130 },
      { turn: 3, elapsedMs: 2400, tokensPerSec: 124, cumulativeTokens: 254 },
      { turn: 4, elapsedMs: 3100, tokensPerSec: 165, cumulativeTokens: 419 },
      { turn: 5, elapsedMs: 3900, tokensPerSec: 142, cumulativeTokens: 561 },
    ];
    const velocityChart = renderTokenVelocityChartSvg(mockVelPoints, theme);
    const latencyChart = renderLatencyPercentilesSvg({ p50: 240, p90: 820, p99: 1450, max: 1800 }, theme);

    viewContent = `<section class="panel"><div class="panel-header"><span>Analytics &amp; System Telemetry Insights</span></div><div class="charts-grid-neo"><div class="panel" style="padding:14px"><div style="font-size:11px;font-weight:900;margin-bottom:10px;color:#ffffff">GENERATION VELOCITY DYNAMICS</div>${velocityChart}</div><div class="panel" style="padding:14px"><div style="font-size:11px;font-weight:900;margin-bottom:10px;color:#ffffff">TOOL &amp; REASONING LATENCY BREAKDOWN</div>${latencyChart}</div></div></section>`;
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
  var isPlaying = false;
  var timer = null;
  var eventCount = 0;
  var lastSecCount = 0;
  var ws = null;

  window.appSetView = function(view) {
    var params = new URLSearchParams(window.location.search);
    params.set('view', view);
    window.history.replaceState({}, '', window.location.pathname + '?' + params.toString());
    window.location.reload();
  };

  window.appSetTheme = function(mode) {
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

  window.appSetDiffMode = function(mode) {
    var params = new URLSearchParams(window.location.search);
    params.set('diffMode', mode);
    window.history.replaceState({}, '', window.location.pathname + '?' + params.toString());
    window.location.reload();
  };

  window.appTogglePlay = function() {
    isPlaying = !isPlaying;
    var btn = document.querySelector('.scrubber-bar button');
    if (btn) btn.textContent = isPlaying ? 'PAUSE' : 'PLAY';
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

  function connectWebSocket() {
    try {
      var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      var wsUrl = protocol + '//' + window.location.host + '/tunnel';
      ws = new WebSocket(wsUrl);
      ws.onmessage = function(ev) {
        eventCount += 1;
        var box = document.getElementById('live-log-box');
        var countEl = document.getElementById('live-frame-count');
        if (box) {
          box.textContent = ev.data + '\\n' + box.textContent.slice(0, 4000);
        }
        if (countEl) countEl.textContent = String(eventCount);
      };
      ws.onerror = function() {};
    } catch (e) {}
  }

  window.appReconnectWs = function() {
    if (ws) {
      try { ws.close(); } catch (e) {}
    }
    connectWebSocket();
  };

  setInterval(function() {
    var diff = eventCount - lastSecCount;
    lastSecCount = eventCount;
    var fpsEl = document.getElementById('live-fps-meter');
    if (fpsEl) fpsEl.textContent = diff.toFixed(1) + ' evt/s';
  }, 1000);

  try {
    var es = new EventSource('/api/sse');
    es.onmessage = function(ev) {
      eventCount += 1;
      try {
        var d = JSON.parse(ev.data);
        var box = document.getElementById('live-log-box');
        var countEl = document.getElementById('live-frame-count');
        if (box) {
          box.textContent = JSON.stringify(d, null, 2) + '\\n\\n' + box.textContent.slice(0, 3000);
        }
        if (countEl) countEl.textContent = String(eventCount);
      } catch (err) {}
    };
  } catch (err) {}

  connectWebSocket();
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


import { writeFileSync } from "node:fs";
import type {
  ReplaySession,
  WebPlayerOptions,
  CgroupTelemetryPoint,
} from "./types.js";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderSvgTelemetryChart(points: readonly CgroupTelemetryPoint[], width = 500, height = 120): string {
  if (points.length === 0) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><text x="10" y="60" fill="#888">No telemetry data</text></svg>`;
  }

  const maxCpu = Math.max(100, ...points.map((p) => p.cpuPercent));
  const maxMem = Math.max(512, ...points.map((p) => p.memoryRssMb));
  const count = points.length;
  const stepX = count > 1 ? (width - 40) / (count - 1) : 0;

  const cpuPolyline = points
    .map((p, i) => {
      const x = 20 + i * stepX;
      const y = height - 20 - (p.cpuPercent / maxCpu) * (height - 40);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const memPolyline = points
    .map((p, i) => {
      const x = 20 + i * stepX;
      const y = height - 20 - (p.memoryRssMb / maxMem) * (height - 40);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return `
    <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" class="chart-svg" style="background:#1e1e2e;border-radius:8px;padding:8px">
      <line x1="20" y1="${height - 20}" x2="${width - 20}" y2="${height - 20}" stroke="#45475a" stroke-width="1" />
      <line x1="20" y1="20" x2="20" y2="${height - 20}" stroke="#45475a" stroke-width="1" />
      <polyline fill="none" stroke="#a6e3a1" stroke-width="2" points="${cpuPolyline}" />
      <polyline fill="none" stroke="#f9e2af" stroke-width="2" points="${memPolyline}" />
      <text x="25" y="16" fill="#a6e3a1" font-size="11" font-family="sans-serif">CPU % (Peak: ${maxCpu.toFixed(0)}%)</text>
      <text x="180" y="16" fill="#f9e2af" font-size="11" font-family="sans-serif">Memory RSS (Peak: ${maxMem.toFixed(0)}MB)</text>
    </svg>
  `;
}

export function generateWebReplayHtml(session: ReplaySession, options: WebPlayerOptions = {}): string {
  const meta = session.metadata;
  const title = options.title ?? `Replay: ${meta.scenarioId} (${meta.skillId})`;
  const sessionJson = JSON.stringify(session).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  const svgChart = renderSvgTelemetryChart(session.telemetrySeries);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #11111b; --surface: #1e1e2e; --overlay: #313244;
      --text: #cdd6f4; --subtext: #a6adc8; --primary: #89b4fa;
      --green: #a6e3a1; --red: #f38ba8; --yellow: #f9e2af; --mauve: #cba6f7;
    }
    html, body, div, span, p, h1, h2, h3, h4, ul, li, aside, main, header, footer, button, input, select { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    header { background: var(--surface); padding: 12px 20px; border-bottom: 1px solid var(--overlay); display: flex; justify-content: space-between; align-items: center; }
    .meta-badges { display: flex; gap: 8px; align-items: center; }
    .badge { padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; background: var(--overlay); }
    .badge.completed { background: rgba(166,227,161,0.2); color: var(--green); }
    .badge.failed { background: rgba(243,139,168,0.2); color: var(--red); }
    .main-container { display: flex; flex: 1; overflow: hidden; }
    .sidebar { width: 340px; background: var(--surface); border-right: 1px solid var(--overlay); display: flex; flex-direction: column; }
    .sidebar-controls { padding: 10px; border-bottom: 1px solid var(--overlay); display: flex; gap: 6px; }
    .sidebar-controls input { flex: 1; background: var(--bg); border: 1px solid var(--overlay); color: var(--text); padding: 6px 10px; border-radius: 4px; font-size: 12px; }
    .frame-list { flex: 1; overflow-y: auto; list-style: none; }
    .frame-item { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
    .frame-item:hover { background: rgba(137,180,250,0.08); }
    .frame-item.active { background: rgba(137,180,250,0.18); border-left: 3px solid var(--primary); }
    .frame-item-header { display: flex; justify-content: space-between; font-weight: 600; color: var(--primary); }
    .content-area { flex: 1; display: flex; flex-direction: column; overflow-y: auto; padding: 20px; gap: 16px; }
    .tab-bar { display: flex; gap: 8px; border-bottom: 1px solid var(--overlay); padding-bottom: 8px; }
    .tab-btn { background: transparent; border: none; color: var(--subtext); padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 600; }
    .tab-btn.active { background: var(--overlay); color: var(--text); }
    .card { background: var(--surface); border-radius: 8px; padding: 16px; border: 1px solid var(--overlay); }
    .code-block { background: var(--bg); padding: 12px; border-radius: 6px; font-family: monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; max-height: 240px; overflow-y: auto; color: var(--text); border: 1px solid var(--overlay); }
    .diff-line.plus { color: var(--green); background: rgba(166,227,161,0.1); }
    .diff-line.minus { color: var(--red); background: rgba(243,139,168,0.1); }
    footer { background: var(--surface); padding: 10px 20px; border-top: 1px solid var(--overlay); display: flex; align-items: center; gap: 14px; }
    .btn { background: var(--overlay); border: none; color: var(--text); padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: 600; }
    .btn:hover { background: var(--primary); color: var(--bg); }
    .slider { flex: 1; accent-color: var(--primary); cursor: pointer; }
  </style>
</head>
<body>
  <header>
    <div>
      <h2 style="font-size:16px">${escapeHtml(meta.scenarioId)} &bull; ${escapeHtml(meta.skillId)}</h2>
      <div style="font-size:12px;color:var(--subtext);margin-top:2px">Model: ${escapeHtml(meta.modelId)} | Duration: ${(meta.durationMs/1000).toFixed(2)}s | Turns: ${meta.totalTurns} | Cost: $${meta.totalCostUSD.toFixed(4)}</div>
    </div>
    <div class="meta-badges">
      <span class="badge ${meta.status === 'completed' ? 'completed' : 'failed'}">${escapeHtml(meta.status)}</span>
    </div>
  </header>

  <div class="main-container">
    <aside class="sidebar">
      <div class="sidebar-controls">
        <input type="text" id="filter-input" placeholder="Search frames..." oninput="onFilterChange()">
      </div>
      <ul class="frame-list" id="frame-list"></ul>
    </aside>

    <main class="content-area">
      <div class="tab-bar">
        <button class="tab-btn active" onclick="switchTab('overview')">Overview</button>
        <button class="tab-btn" onclick="switchTab('tool')">Tool Invocation</button>
        <button class="tab-btn" onclick="switchTab('thinking')">Reasoning Stream</button>
        <button class="tab-btn" onclick="switchTab('diff')">Workspace Diff</button>
        <button class="tab-btn" onclick="switchTab('telemetry')">Host Telemetry</button>
      </div>

      <div id="tab-content" class="card"></div>

      <div class="card">
        <h3 style="font-size:14px;margin-bottom:10px;color:var(--primary)">Resource Telemetry Chart</h3>
        ${svgChart}
      </div>
    </main>
  </div>

  <footer>
    <button class="btn" id="play-btn" onclick="togglePlay()">Play</button>
    <button class="btn" onclick="stepFrame(-1)">Prev</button>
    <input type="range" id="time-slider" class="slider" min="0" max="${Math.max(0, session.frames.length - 1)}" value="0" oninput="onSeek(this.value)">
    <button class="btn" onclick="stepFrame(1)">Next</button>
    <span id="frame-indicator" style="font-size:12px;font-family:monospace;width:80px;text-align:right">1 / ${session.frames.length}</span>
    <select id="speed-select" class="btn" onchange="onSpeedChange(this.value)">
      <option value="0.5">0.5x</option>
      <option value="1" selected>1.0x</option>
      <option value="2">2.0x</option>
      <option value="5">5.0x</option>
    </select>
  </footer>

  <script type="application/json" id="replay-data">${sessionJson}</script>
  <script>
    const data = JSON.parse(document.getElementById('replay-data').textContent);
    let currentIndex = 0;
    let isPlaying = false;
    let playTimer = null;
    let activeTab = 'overview';
    let playbackSpeed = 1;

    function renderFrameList() {
      const list = document.getElementById('frame-list');
      const filter = document.getElementById('filter-input').value.toLowerCase();
      list.innerHTML = '';
      data.frames.forEach((f, idx) => {
        if (filter && !f.summary.toLowerCase().includes(filter) && !f.eventType.toLowerCase().includes(filter)) return;
        const li = document.createElement('li');
        li.className = 'frame-item' + (idx === currentIndex ? ' active' : '');
        li.onclick = () => seek(idx);
        li.innerHTML = '<div class="frame-item-header"><span>#' + (idx + 1) + ' ' + f.eventType.toUpperCase() + '</span><span>' + (f.elapsedMs/1000).toFixed(1) + 's</span></div><div style="color:var(--subtext)">' + f.summary + '</div>';
        list.appendChild(li);
      });
    }

    function renderActiveFrame() {
      const f = data.frames[currentIndex];
      if (!f) return;
      document.getElementById('time-slider').value = currentIndex;
      document.getElementById('frame-indicator').textContent = (currentIndex + 1) + ' / ' + data.frames.length;
      renderFrameList();

      const container = document.getElementById('tab-content');
      let html = '';
      if (activeTab === 'overview') {
        const vel = (f.elapsedMs > 0 && f.totalTokens !== undefined) ? (f.totalTokens / (f.elapsedMs / 1000)).toFixed(1) : "0.0";
        html = '<h3 style="font-size:14px;color:var(--primary);margin-bottom:8px">Frame #' + (currentIndex + 1) + ' &bull; Turn #' + f.turnIndex + '</h3>' +
               '<p style="margin-bottom:6px"><strong>Event Type:</strong> ' + f.eventType + '</p>' +
               '<p style="margin-bottom:6px"><strong>Summary:</strong> ' + f.summary + '</p>' +
               '<p style="margin-bottom:6px"><strong>Elapsed Time:</strong> ' + f.elapsedMs + ' ms</p>' +
               '<p style="margin-bottom:6px"><strong>Velocity:</strong> ' + vel + ' tokens/sec</p>' +
               (f.totalCostUSD !== undefined ? '<p><strong>Cumulative Cost:</strong> $' + f.totalCostUSD.toFixed(4) + '</p>' : '');
      } else if (activeTab === 'tool') {
        if (f.toolCall) {
          html = '<h3 style="font-size:14px;color:var(--primary);margin-bottom:8px">Tool: ' + f.toolCall.toolName + '</h3>' +
                 '<p style="font-size:12px;color:var(--subtext);margin-bottom:6px">Call ID: ' + f.toolCall.callId + '</p>' +
                 '<div class="code-block">' + JSON.stringify(f.toolCall.inputPayload, null, 2) + '</div>' +
                 (f.toolCall.stdout ? '<h4 style="font-size:12px;margin:8px 0 4px">Stdout:</h4><div class="code-block">' + f.toolCall.stdout + '</div>' : '') +
                 (f.toolCall.stderr ? '<h4 style="font-size:12px;margin:8px 0 4px;color:var(--red)">Stderr:</h4><div class="code-block" style="color:var(--red)">' + f.toolCall.stderr + '</div>' : '');
        } else {
          html = '<p style="color:var(--subtext)">No tool call in this frame.</p>';
        }
      } else if (activeTab === 'thinking') {
        if (f.thinking) {
          html = '<h3 style="font-size:14px;color:var(--mauve);margin-bottom:8px">Reasoning Stream (' + f.thinking.tokenCount + ' tokens)</h3>' +
                 '<div class="code-block">' + f.thinking.thoughtChunk + '</div>';
        } else {
          html = '<p style="color:var(--subtext)">No thinking tokens in this frame.</p>';
        }
      } else if (activeTab === 'diff') {
        if (f.diff) {
          html = '<h3 style="font-size:14px;color:var(--yellow);margin-bottom:8px">File Mutation (Side-by-Side): ' + f.diff.path + ' (' + f.diff.changeType + ')</h3>' +
                 '<p style="margin-bottom:6px;color:var(--green)">+' + f.diff.insertions + ' <span style="color:var(--red)">-' + f.diff.deletions + '</span></p>' +
                 '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div class="code-block" style="border-left:3px solid var(--red)"><strong>BEFORE</strong><br/>' + (f.diff.diffHunk || 'No baseline') + '</div><div class="code-block" style="border-left:3px solid var(--green)"><strong>AFTER</strong><br/>' + (f.diff.diffHunk || 'No mutation') + '</div></div>';
        } else {
          html = '<p style="color:var(--subtext)">No workspace mutations in this frame.</p>';
        }
      } else if (activeTab === 'telemetry') {
        const tel = f.telemetry || data.telemetrySeries[0];
        if (tel) {
          html = '<h3 style="font-size:14px;color:var(--green);margin-bottom:8px">Host Telemetry Snapshot</h3>' +
                 '<p style="margin-bottom:4px"><strong>CPU:</strong> ' + tel.cpuPercent.toFixed(1) + '%</p>' +
                 '<p style="margin-bottom:4px"><strong>Memory RSS:</strong> ' + tel.memoryRssMb.toFixed(1) + ' MB / ' + tel.memoryLimitMb + ' MB (' + tel.memoryPercent.toFixed(1) + '%)</p>' +
                 '<p style="margin-bottom:4px"><strong>Disk I/O:</strong> Read ' + tel.diskReadKb + ' KB | Write ' + tel.diskWriteKb + ' KB</p>' +
                 '<p style="margin-bottom:4px"><strong>Network:</strong> Rx ' + tel.networkRxKb + ' KB | Tx ' + tel.networkTxKb + ' KB</p>' +
                 '<p><strong>Active PIDs:</strong> ' + tel.activePids + '</p>';
        } else {
          html = '<p style="color:var(--subtext)">No telemetry recorded.</p>';
        }
      }
      container.innerHTML = html;
    }

    function switchTab(tab) {
      activeTab = tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      renderActiveFrame();
    }

    function seek(idx) {
      currentIndex = Math.max(0, Math.min(data.frames.length - 1, idx));
      renderActiveFrame();
    }

    function onSeek(val) {
      seek(parseInt(val, 10));
    }

    function stepFrame(delta) {
      seek(currentIndex + delta);
    }

    function togglePlay() {
      isPlaying = !isPlaying;
      document.getElementById('play-btn').textContent = isPlaying ? 'Pause' : 'Play';
      if (isPlaying) {
        if (currentIndex >= data.frames.length - 1) currentIndex = 0;
        playTimer = setInterval(() => {
          if (currentIndex < data.frames.length - 1) {
            seek(currentIndex + 1);
          } else {
            togglePlay();
          }
        }, Math.round(500 / playbackSpeed));
      } else {
        clearInterval(playTimer);
      }
    }

    function onSpeedChange(val) {
      playbackSpeed = parseFloat(val);
      if (isPlaying) {
        togglePlay();
        togglePlay();
      }
    }

    function onFilterChange() {
      renderFrameList();
    }

    renderActiveFrame();
  </script>
</body>
</html>`;
}

export function exportWebReplayHtml(session: ReplaySession, outputPath: string, options: WebPlayerOptions = {}): void {
  const html = generateWebReplayHtml(session, options);
  writeFileSync(outputPath, html, "utf8");
}

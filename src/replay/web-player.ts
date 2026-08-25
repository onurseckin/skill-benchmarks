import type { CgroupTelemetryPoint, ReplaySession, WebPlayerOptions } from "./types.js";
import { writeReplayExportAtomic } from "./replay-export.js";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function serializeEmbeddedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function renderSvgTelemetryChart(points: readonly CgroupTelemetryPoint[], width: number = 500, height: number = 120): string {
  if (points.length === 0) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><text x="10" y="60" fill="#888">No telemetry data</text></svg>`;
  }
  const peakCpu = Math.max(...points.map((point) => point.cpuPercent));
  const peakMemory = Math.max(...points.map((point) => point.memoryRssMb));
  const cpuAxisMaximum = Math.max(100, peakCpu, 1);
  const memoryAxisMaximum = Math.max(...points.map((point) => point.memoryLimitMb), peakMemory, 1);
  const stepX = points.length > 1 ? (width - 40) / (points.length - 1) : 0;
  const cpuPolyline = points.map((point, index) => {
    const x = 20 + index * stepX;
    const y = height - 20 - (point.cpuPercent / cpuAxisMaximum) * (height - 40);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const memoryPolyline = points.map((point, index) => {
    const x = 20 + index * stepX;
    const y = height - 20 - (point.memoryRssMb / memoryAxisMaximum) * (height - 40);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" class="chart-svg">
    <line x1="20" y1="${height - 20}" x2="${width - 20}" y2="${height - 20}" stroke="#45475a" />
    <line x1="20" y1="20" x2="20" y2="${height - 20}" stroke="#45475a" />
    <polyline fill="none" stroke="#a6e3a1" stroke-width="2" points="${cpuPolyline}" />
    <polyline fill="none" stroke="#f9e2af" stroke-width="2" points="${memoryPolyline}" />
    <text x="25" y="16" fill="#a6e3a1" font-size="11">CPU peak: ${peakCpu.toFixed(1)}%</text>
    <text x="180" y="16" fill="#f9e2af" font-size="11">Memory peak: ${peakMemory.toFixed(1)} MB</text>
  </svg>`;
}

export function generateWebReplayHtml(session: ReplaySession, options: WebPlayerOptions = {}): string {
  const metadata = session.metadata;
  const title = options.title ?? `Replay: ${metadata.scenarioId}`;
  const provenance = [
    metadata.providerId,
    metadata.executionMode,
    metadata.simulated === undefined ? undefined : (metadata.simulated ? "simulated" : "nonsimulated"),
  ].filter(Boolean).join(" · ");
  const totals = [
    `Duration: ${(metadata.durationMs / 1000).toFixed(2)}s`,
    `Turns: ${metadata.totalTurns}`,
    metadata.totalTokens === undefined ? undefined : `Tokens: ${metadata.totalTokens}`,
    metadata.totalCostUSD === undefined ? undefined : `Cost: $${metadata.totalCostUSD.toFixed(6)}`,
  ].filter(Boolean).join(" · ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --bg:#11111b; --surface:#1e1e2e; --overlay:#313244; --text:#cdd6f4; --subtext:#a6adc8; --primary:#89b4fa; --green:#a6e3a1; --red:#f38ba8; --yellow:#f9e2af; --mauve:#cba6f7; }
    html, body, header, div, aside, main, section, footer, button, input, select, ul, li, span, pre, p, h3, strong { box-sizing:border-box; }
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--bg); color:var(--text); display:flex; flex-direction:column; min-height:100vh; }
    header { background:var(--surface); padding:14px 20px; border-bottom:1px solid var(--overlay); display:flex; justify-content:space-between; gap:18px; align-items:center; }
    header p { margin:4px 0 0; color:var(--subtext); font-size:12px; }
    .badge { padding:4px 9px; border-radius:4px; font-size:12px; font-weight:700; text-transform:uppercase; background:rgba(137,180,250,.18); color:var(--primary); }
    .main { display:grid; grid-template-columns:minmax(250px,340px) 1fr; flex:1; min-height:0; }
    aside { background:var(--surface); border-right:1px solid var(--overlay); display:flex; flex-direction:column; min-height:0; }
    aside input { margin:10px; background:var(--bg); border:1px solid var(--overlay); color:var(--text); padding:8px 10px; border-radius:5px; }
    ul { list-style:none; padding:0; margin:0; overflow:auto; }
    li { padding:10px 14px; border-top:1px solid rgba(255,255,255,.05); cursor:pointer; font-size:12px; }
    li.active { background:rgba(137,180,250,.16); border-left:3px solid var(--primary); }
    .frame-head { display:flex; justify-content:space-between; color:var(--primary); font-weight:700; }
    .frame-summary { margin-top:4px; color:var(--subtext); overflow-wrap:anywhere; }
    main { padding:20px; overflow:auto; }
    .tabs { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
    button, select { background:var(--overlay); border:0; color:var(--text); padding:7px 12px; border-radius:5px; cursor:pointer; }
    button.active { background:var(--primary); color:var(--bg); }
    .card { background:var(--surface); border:1px solid var(--overlay); border-radius:8px; padding:16px; margin-bottom:16px; }
    .row { margin:0 0 8px; overflow-wrap:anywhere; }
    pre { background:var(--bg); border:1px solid var(--overlay); padding:12px; border-radius:6px; white-space:pre-wrap; overflow-wrap:anywhere; max-height:300px; overflow:auto; }
    .chart-svg { background:var(--surface); border-radius:8px; }
    footer { background:var(--surface); border-top:1px solid var(--overlay); padding:10px 20px; display:flex; align-items:center; gap:10px; }
    footer input { flex:1; }
    @media (max-width:760px) { .main { grid-template-columns:1fr; } aside { max-height:35vh; border-right:0; border-bottom:1px solid var(--overlay); } header { align-items:flex-start; } }
  </style>
</head>
<body>
  <header>
    <div><strong>${escapeHtml(metadata.scenarioId)} · ${escapeHtml(metadata.skillIds.join(", "))}</strong><p>Model: ${escapeHtml(metadata.modelId)}${provenance.length === 0 ? "" : ` · ${escapeHtml(provenance)}`}</p><p>${escapeHtml(totals)}</p></div>
    <span class="badge">${escapeHtml(metadata.executionStatus)}</span>
  </header>
  <div class="main">
    <aside><input id="filter" type="search" placeholder="Search persisted frames"><ul id="frames"></ul></aside>
    <main>
      <div class="tabs" id="tabs">
        <button data-tab="overview" class="active">Overview</button><button data-tab="tool">Tool and command</button><button data-tab="thinking">Reasoning</button><button data-tab="diff">Diff</button><button data-tab="telemetry">Telemetry</button>
      </div>
      <section class="card" id="content"></section>
      <section class="card"><strong>Recorded resource telemetry</strong>${renderSvgTelemetryChart(session.telemetrySeries)}</section>
    </main>
  </div>
  <footer><button id="play">Play</button><button id="previous">Previous</button><input id="seek" type="range" min="0" max="${session.frames.length - 1}" value="0"><button id="next">Next</button><span id="indicator"></span><select id="speed"><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="2">2x</option><option value="5">5x</option></select></footer>
  <script type="application/json" id="replay-data">${serializeEmbeddedJson(session)}</script>
  <script>
    const data = JSON.parse(document.getElementById('replay-data').textContent);
    const frameList = document.getElementById('frames');
    const content = document.getElementById('content');
    const seekInput = document.getElementById('seek');
    const indicator = document.getElementById('indicator');
    const filterInput = document.getElementById('filter');
    const playButton = document.getElementById('play');
    let currentIndex = 0;
    let activeTab = 'overview';
    let timer;
    const element = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const addRow = (label, value) => content.appendChild(element('p', 'row', label + ': ' + value));
    const addPre = (value) => content.appendChild(element('pre', '', value));
    function renderFrameList() {
      const filter = filterInput.value.toLowerCase();
      const nodes = [];
      data.frames.forEach((frame, index) => {
        if (filter && !frame.summary.toLowerCase().includes(filter) && !frame.sourceEventType.toLowerCase().includes(filter)) return;
        const item = element('li', index === currentIndex ? 'active' : '');
        const heading = element('div', 'frame-head');
        heading.append(element('span', '', '#' + (index + 1) + ' ' + frame.sourceEventType), element('span', '', (frame.elapsedMs / 1000).toFixed(3) + 's'));
        item.append(heading, element('div', 'frame-summary', frame.summary));
        item.addEventListener('click', () => seek(index));
        nodes.push(item);
      });
      frameList.replaceChildren(...nodes);
    }
    function renderActiveFrame() {
      const frame = data.frames[currentIndex];
      if (!frame) return;
      content.replaceChildren(element('h3', '', 'Persisted frame #' + (currentIndex + 1)));
      if (activeTab === 'overview') {
        addRow('Event type', frame.sourceEventType);
        addRow('Summary', frame.summary);
        addRow('Timestamp µs', frame.timestampUs);
        addRow('Elapsed ms', String(frame.elapsedMs));
        if (frame.turnIndex !== undefined) addRow('Turn', String(frame.turnIndex));
        if (frame.totalTokens !== undefined && frame.elapsedMs > 0) addRow('Token velocity', (frame.totalTokens / (frame.elapsedMs / 1000)).toFixed(1) + ' tokens/sec');
        addPre(JSON.stringify(frame.payload, null, 2));
      } else if (activeTab === 'tool') {
        if (frame.toolCall) {
          addRow('Tool', frame.toolCall.toolName);
          addRow('Call ID', frame.toolCall.callId);
          if (frame.toolCall.inputPayload !== undefined) addPre(JSON.stringify(frame.toolCall.inputPayload, null, 2));
          if (frame.toolCall.durationMs !== undefined) addRow('Duration ms', String(frame.toolCall.durationMs));
          if (frame.toolCall.exitCode !== undefined) addRow('Exit code', String(frame.toolCall.exitCode));
        } else if (frame.command) {
          addRow('Command ID', frame.command.commandId);
          if (frame.command.stream) addRow('Stream', frame.command.stream);
          if (frame.command.chunk !== undefined) addPre(frame.command.chunk);
          if (frame.command.durationMs !== undefined) addRow('Duration ms', String(frame.command.durationMs));
          if (frame.command.exitCode !== undefined) addRow('Exit code', String(frame.command.exitCode));
        } else addRow('Availability', 'No tool or command evidence in this frame');
      } else if (activeTab === 'thinking') {
        if (frame.thinking) addPre(frame.thinking.thoughtChunk);
        else addRow('Availability', 'No reasoning evidence in this frame');
      } else if (activeTab === 'diff') {
        if (frame.diff) {
          addRow('Path', frame.diff.path);
          addRow('Changes', '+' + frame.diff.insertions + ' -' + frame.diff.deletions);
          if (frame.diff.diffHunk !== undefined) addPre(frame.diff.diffHunk);
        } else addRow('Availability', 'No diff evidence in this frame');
      } else if (activeTab === 'telemetry') {
        if (frame.telemetry) {
          addRow('CPU', frame.telemetry.cpuPercent.toFixed(1) + '%');
          addRow('Memory RSS', frame.telemetry.memoryRssMb.toFixed(1) + ' MB');
          addRow('Memory limit', frame.telemetry.memoryLimitMb.toFixed(1) + ' MB');
          addRow('Active PIDs', String(frame.telemetry.activePids));
        } else addRow('Availability', 'No telemetry evidence in this frame');
      }
      seekInput.value = String(currentIndex);
      indicator.textContent = (currentIndex + 1) + ' / ' + data.frames.length;
      renderFrameList();
    }
    function seek(index) { currentIndex = Math.max(0, Math.min(data.frames.length - 1, Number(index))); renderActiveFrame(); }
    document.getElementById('tabs').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-tab]');
      if (!button) return;
      activeTab = button.dataset.tab;
      document.querySelectorAll('button[data-tab]').forEach((item) => item.classList.toggle('active', item === button));
      renderActiveFrame();
    });
    filterInput.addEventListener('input', renderFrameList);
    seekInput.addEventListener('input', () => seek(seekInput.value));
    document.getElementById('previous').addEventListener('click', () => seek(currentIndex - 1));
    document.getElementById('next').addEventListener('click', () => seek(currentIndex + 1));
    playButton.addEventListener('click', () => {
      if (timer) { clearInterval(timer); timer = undefined; playButton.textContent = 'Play'; return; }
      playButton.textContent = 'Pause';
      timer = setInterval(() => {
        if (currentIndex >= data.frames.length - 1) { clearInterval(timer); timer = undefined; playButton.textContent = 'Play'; return; }
        seek(currentIndex + 1);
      }, Math.max(20, Math.round(500 / Number(document.getElementById('speed').value))));
    });
    renderActiveFrame();
  </script>
</body>
</html>`;
}

export function exportWebReplayHtml(session: ReplaySession, outputPath: string, options: WebPlayerOptions = {}): void {
  writeReplayExportAtomic(outputPath, generateWebReplayHtml(session, options));
}

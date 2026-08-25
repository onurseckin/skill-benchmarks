import type {
  AppView,
  ChartPoint,
  DiffLineModel,
  DiffViewModel,
  KpiCardModel,
  LeaderboardViewModel,
  MetricBadgeModel,
  MetricBadgeVariant,
  ReplayViewModel,
  TelemetryChartData,
  ThemeTokens,
} from "./types.js";
import type {
  ThinkingEvent,
  ToolCallEvent,
  TrajectoryFrame,
} from "../replay/types.js";

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderMetricBadge(badge: MetricBadgeModel, theme: ThemeTokens): string {
  const variantStyles: Record<MetricBadgeVariant, { bg: string; color: string; border: string }> = {
    success: { bg: "#000000", color: "#ffffff", border: "#ffffff" },
    warning: { bg: "#000000", color: "#ffffff", border: "#ffffff" },
    error: { bg: "#ffffff", color: "#000000", border: "#ffffff" },
    info: { bg: "#000000", color: "#ffffff", border: "#ffffff" },
    neutral: { bg: "#000000", color: "#cccccc", border: "#888888" },
    primary: { bg: "#ffffff", color: "#000000", border: "#ffffff" },
    mauve: { bg: "#000000", color: "#ffffff", border: "#ffffff" },
    cyan: { bg: "#000000", color: "#ffffff", border: "#ffffff" },
  };

  const style = variantStyles[badge.variant] ?? variantStyles.neutral;
  const deltaHtml = badge.delta
    ? `<span style="font-size:10px;margin-left:6px;color:${style.color};font-weight:700">[${escapeHtml(badge.delta)}]</span>`
    : "";
  const iconHtml = badge.icon ? `<span style="margin-right:4px">${escapeHtml(badge.icon)}</span>` : "";

  return `<span class="badge" title="${escapeHtml(badge.tooltip ?? badge.label)}" style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:0px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;background:${style.bg};color:${style.color};border:2px solid ${style.border};box-shadow:2px 2px 0px #ffffff;font-family:${theme.fontMono}">${iconHtml}${escapeHtml(badge.label)}: ${escapeHtml(String(badge.value))}${deltaHtml}</span>`;
}

export function renderKpiCard(kpi: KpiCardModel, theme: ThemeTokens): string {
  return `<div class="kpi-card" style="background:#000000;border:2px solid #ffffff;border-radius:0px;box-shadow:4px 4px 0px #ffffff;padding:16px 20px;display:flex;flex-direction:column;gap:6px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#888888;letter-spacing:1px;font-family:${theme.fontMono}">${escapeHtml(kpi.title)}</div><div style="font-size:28px;font-weight:900;color:#ffffff;font-family:${theme.fontMono};letter-spacing:-0.5px">${escapeHtml(String(kpi.value))}</div>${kpi.subtitle ? `<div style="font-size:11px;color:#aaaaaa;font-family:${theme.fontMono}">${escapeHtml(kpi.subtitle)}</div>` : ""}</div>`;
}

export function renderNavbar(activeView: AppView, theme: ThemeTokens, isLiveConnected: boolean): string {
  const views: readonly { id: AppView; label: string }[] = [
    { id: "leaderboard", label: "LEADERBOARD" },
    { id: "replay", label: "REPLAY PLAYER" },
    { id: "live", label: "LIVE TELEMETRY" },
    { id: "analytics", label: "ANALYTICS" },
    { id: "runs", label: "ALL RUNS" },
  ];

  const links = views
    .map((v) => {
      const active = v.id === activeView;
      const bg = active ? "#ffffff" : "#000000";
      const color = active ? "#000000" : "#ffffff";
      return `<button class="nav-tab" onclick="appSetView('${v.id}')" style="background:${bg};color:${color};border:2px solid #ffffff;padding:8px 16px;cursor:pointer;font-size:12px;font-weight:800;border-radius:0px;font-family:${theme.fontMono};box-shadow:${active ? "none" : "2px 2px 0px #ffffff"};text-transform:uppercase;letter-spacing:0.5px">${escapeHtml(v.label)}</button>`;
    })
    .join("");

  const liveBadge = isLiveConnected
    ? `<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#ffffff;font-weight:700;border:1px solid #ffffff;padding:2px 8px;font-family:${theme.fontMono};text-transform:uppercase"><span style="width:6px;height:6px;background:#ffffff;display:inline-block"></span>LIVE CONNECTED</span>`
    : `<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#888888;border:1px solid #888888;padding:2px 8px;font-family:${theme.fontMono};text-transform:uppercase"><span style="width:6px;height:6px;background:#888888;display:inline-block"></span>OFFLINE</span>`;

  return `<header style="background:#000000;border:2px solid #ffffff;box-shadow:4px 4px 0px #ffffff;padding:12px 24px;display:flex;justify-content:space-between;align-items:center;margin-bottom:24px"><div style="display:flex;align-items:center;gap:24px"><div style="font-size:16px;font-weight:900;color:#ffffff;display:flex;align-items:center;gap:8px;font-family:${theme.fontMono};letter-spacing:1px;text-transform:uppercase"><span>⚡</span><span>SKILL BENCHMARKS</span></div><nav style="display:flex;gap:8px">${links}</nav></div><div style="display:flex;align-items:center;gap:16px">${liveBadge}<select onchange="appSetTheme(this.value)" style="background:#000000;border:2px solid #ffffff;color:#ffffff;padding:6px 12px;border-radius:0px;font-size:12px;font-weight:700;font-family:${theme.fontMono};box-shadow:2px 2px 0px #ffffff"><option value="dark">DARK</option><option value="light">LIGHT</option><option value="high-contrast">HIGH CONTRAST</option><option value="cyberpunk">CYBERPUNK</option><option value="monochrome">MONOCHROME</option></select></div></header>`;
}

export function renderLeaderboardTable(model: LeaderboardViewModel, theme: ThemeTokens): string {
  const { categories, activeCategory, searchFilter, sortKey, sortDirection, entries } = model;

  const catOptions = ["all", ...categories]
    .map((c) => `<option value="${escapeHtml(c)}" ${c === activeCategory ? "selected" : ""}>${c === "all" ? "ALL CATEGORIES" : escapeHtml(c.toUpperCase())}</option>`)
    .join("");

  const cols: readonly { key: typeof sortKey; label: string }[] = [
    { key: "rank", label: "RANK" },
    { key: "skillId", label: "SKILL ID" },
    { key: "category", label: "CATEGORY" },
    { key: "passRate", label: "PASS RATE" },
    { key: "averageScore", label: "SCORE" },
    { key: "eloRating", label: "ELO" },
    { key: "meanDurationSeconds", label: "DURATION" },
    { key: "averageCostUSD", label: "COST" },
    { key: "cacheHitRatio", label: "CACHE HIT" },
    { key: "totalRuns", label: "RUNS" },
  ];

  const ths = cols
    .map((c) => {
      const isSorted = c.key === sortKey;
      const arrow = isSorted ? (sortDirection === "asc" ? " ▲" : " ▼") : "";
      return `<th onclick="appSortLeaderboard('${c.key}')" style="background:#ffffff;color:#000000;font-weight:900;padding:12px 14px;text-align:left;cursor:pointer;border-bottom:2px solid #ffffff;border-right:1px solid #000000;white-space:nowrap;font-size:11px;user-select:none;font-family:${theme.fontMono};letter-spacing:1px">${escapeHtml(c.label)}${arrow}</th>`;
    })
    .join("");

  const rows = entries
    .map((e) => {
      const isSelected = e.skillId === model.selectedSkillId;
      const rowBg = isSelected ? "#222222" : "#000000";
      const cachePct = (e.cacheHitRatio * (e.cacheHitRatio <= 1 ? 100 : 1)).toFixed(1);
      const cost = e.averageCostUSD === undefined ? "UNVERIFIED" : `$${e.averageCostUSD.toFixed(4)}`;

      return `<tr onclick="appSelectSkill('${escapeHtml(e.skillId)}')" style="background:${rowBg};cursor:pointer;border-bottom:1px solid #333333"><td style="padding:10px 14px;font-family:${theme.fontMono};font-weight:700;color:#888888">#${e.rank}</td><td style="padding:10px 14px;font-weight:800;color:#ffffff;font-family:${theme.fontMono}">${escapeHtml(e.skillId)}</td><td style="padding:10px 14px"><span style="background:#000000;border:1px solid #ffffff;padding:2px 8px;border-radius:0px;font-size:10px;font-weight:700;font-family:${theme.fontMono};text-transform:uppercase">${escapeHtml(e.category)}</span></td><td style="padding:10px 14px;font-family:${theme.fontMono};color:#ffffff;font-weight:800">${e.passRate.toFixed(1)}%</td><td style="padding:10px 14px;font-family:${theme.fontMono};color:#cccccc">${e.averageScore.toFixed(3)}</td><td style="padding:10px 14px;font-family:${theme.fontMono};font-weight:800;color:#ffffff">${Math.round(e.eloRating)}</td><td style="padding:10px 14px;font-family:${theme.fontMono};color:#aaaaaa">${e.meanDurationSeconds.toFixed(2)}s</td><td style="padding:10px 14px;font-family:${theme.fontMono};color:#aaaaaa">${cost}</td><td style="padding:10px 14px;font-family:${theme.fontMono};color:#aaaaaa">${cachePct}%</td><td style="padding:10px 14px;font-family:${theme.fontMono};color:#ffffff;font-weight:700">${e.totalRuns}</td></tr>`;
    })
    .join("");

  return `<div class="leaderboard-container" style="display:flex;flex-direction:column;gap:16px"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><select onchange="appFilterCategory(this.value)" style="background:#000000;border:2px solid #ffffff;color:#ffffff;padding:8px 12px;border-radius:0px;font-size:12px;font-weight:700;font-family:${theme.fontMono};box-shadow:2px 2px 0px #ffffff">${catOptions}</select><input type="text" placeholder="FILTER SKILLS OR CATEGORIES..." value="${escapeHtml(searchFilter)}" oninput="appSearchLeaderboard(this.value)" style="background:#000000;border:2px solid #ffffff;color:#ffffff;padding:8px 14px;border-radius:0px;font-size:12px;font-family:${theme.fontMono};flex:1;min-width:240px;box-shadow:2px 2px 0px #ffffff"/></div><div style="overflow-x:auto;border:2px solid #ffffff;border-radius:0px;box-shadow:4px 4px 0px #ffffff"><table style="width:100%;border-collapse:collapse;font-size:12px;background:#000000"><thead><tr>${ths}</tr></thead><tbody>${rows.length > 0 ? rows : `<tr><td colspan="10" style="padding:32px;text-align:center;color:#888888;font-family:${theme.fontMono};font-weight:700">NO SKILLS MATCH THE CURRENT FILTER.</td></tr>`}</tbody></table></div></div>`;
}

export function renderTrajectoryScrubber(model: ReplayViewModel, theme: ThemeTokens): string {
  const { session, currentFrameIndex, isPlaying, playbackSpeed } = model;
  const frames = session?.frames ?? [];
  const total = frames.length;

  return `<div class="scrubber-bar" style="background:#000000;border:2px solid #ffffff;box-shadow:4px 4px 0px #ffffff;padding:12px 20px;display:flex;align-items:center;gap:12px;border-radius:0px"><button onclick="appTogglePlay()" style="background:#ffffff;color:#000000;border:2px solid #ffffff;padding:6px 16px;border-radius:0px;font-weight:900;cursor:pointer;font-size:12px;font-family:${theme.fontMono};box-shadow:2px 2px 0px #ffffff;text-transform:uppercase">${isPlaying ? "PAUSE" : "PLAY"}</button><button onclick="appStepFrame(-1)" style="background:#000000;color:#ffffff;border:2px solid #ffffff;padding:6px 14px;border-radius:0px;font-size:12px;font-weight:700;cursor:pointer;font-family:${theme.fontMono};box-shadow:2px 2px 0px #ffffff">PREV</button><input type="range" min="0" max="${Math.max(0, total - 1)}" value="${currentFrameIndex}" oninput="appSeekFrame(parseInt(this.value, 10))" style="flex:1;accent-color:#ffffff;cursor:pointer"/><button onclick="appStepFrame(1)" style="background:#000000;color:#ffffff;border:2px solid #ffffff;padding:6px 14px;border-radius:0px;font-size:12px;font-weight:700;cursor:pointer;font-family:${theme.fontMono};box-shadow:2px 2px 0px #ffffff">NEXT</button><span style="font-family:${theme.fontMono};font-size:12px;font-weight:700;color:#ffffff;min-width:80px;text-align:right">${currentFrameIndex + 1} / ${total || 1}</span><select onchange="appSetPlaybackSpeed(parseFloat(this.value))" style="background:#000000;border:2px solid #ffffff;color:#ffffff;padding:6px 8px;border-radius:0px;font-size:12px;font-weight:700;font-family:${theme.fontMono};box-shadow:2px 2px 0px #ffffff"><option value="0.5" ${playbackSpeed === 0.5 ? "selected" : ""}>0.5X</option><option value="1" ${playbackSpeed === 1 ? "selected" : ""}>1.0X</option><option value="2" ${playbackSpeed === 2 ? "selected" : ""}>2.0X</option><option value="5" ${playbackSpeed === 5 ? "selected" : ""}>5.0X</option></select></div>`;
}

export function renderDiffViewer(diff: DiffViewModel, theme: ThemeTokens): string {
  const lineHtmls = diff.lines
    .map((l) => {
      let bg = "#000000";
      let color = "#ffffff";
      let sign = " ";
      if (l.type === "add") {
        bg = "#111111";
        color = "#ffffff";
        sign = "+";
      } else if (l.type === "del") {
        bg = "#1a1a1a";
        color = "#888888";
        sign = "-";
      } else if (l.type === "header") {
        bg = "#ffffff";
        color = "#000000";
        sign = "@";
      }

      return `<div style="background:${bg};color:${color};display:flex;padding:2px 8px;font-family:${theme.fontMono};font-size:12px;line-height:1.4;border-bottom:1px solid #222222"><span style="width:40px;color:#666666;user-select:none;text-align:right;padding-right:8px;font-weight:700">${l.oldLineNumber ?? ""}</span><span style="width:40px;color:#666666;user-select:none;text-align:right;padding-right:8px;font-weight:700">${l.newLineNumber ?? ""}</span><span style="width:16px;user-select:none;font-weight:900">${sign}</span><span style="flex:1;white-space:pre-wrap;word-break:break-all">${escapeHtml(l.content)}</span></div>`;
    })
    .join("");

  return `<div class="diff-viewer" style="background:#000000;border:2px solid #ffffff;border-radius:0px;box-shadow:4px 4px 0px #ffffff;overflow:hidden"><div style="background:#000000;padding:10px 16px;border-bottom:2px solid #ffffff;display:flex;justify-content:space-between;align-items:center"><span style="font-family:${theme.fontMono};font-weight:900;font-size:13px;color:#ffffff;text-transform:uppercase">${escapeHtml(diff.path)}</span><span style="font-family:${theme.fontMono};font-size:12px;font-weight:700"><span style="color:#ffffff">+${diff.insertions}</span> <span style="color:#888888">-${diff.deletions}</span></span></div><div style="max-height:400px;overflow-y:auto">${lineHtmls}</div></div>`;
}

export function parseRawDiffToModel(path: string, rawDiff: string, changeType = "modified"): DiffViewModel {
  const lines: DiffLineModel[] = [];
  let insertions = 0;
  let deletions = 0;
  let oldLine = 1;
  let newLine = 1;

  for (const rawLine of rawDiff.split("\n")) {
    if (rawLine.startsWith("@@")) {
      lines.push({ type: "header", content: rawLine });
    } else if (rawLine.startsWith("+")) {
      insertions += 1;
      lines.push({ type: "add", content: rawLine.slice(1), newLineNumber: newLine++ });
    } else if (rawLine.startsWith("-")) {
      deletions += 1;
      lines.push({ type: "del", content: rawLine.slice(1), oldLineNumber: oldLine++ });
    } else {
      lines.push({ type: "ctx", content: rawLine.startsWith(" ") ? rawLine.slice(1) : rawLine, oldLineNumber: oldLine++, newLineNumber: newLine++ });
    }
  }

  return { path, changeType, insertions, deletions, lines };
}

export function renderTelemetryChartSvg(data: TelemetryChartData, theme: ThemeTokens, options: { width?: number; height?: number } = {}): string {
  const width = options.width ?? data.width ?? 600;
  const height = options.height ?? data.height ?? 160;
  const padLeft = 40;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 30;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const { series, minX, maxX, minY, maxY } = data;
  const rangeX = Math.max(1, maxX - minX);
  const rangeY = Math.max(1, maxY - minY);

  const scaleX = (x: number): number => padLeft + ((x - minX) / rangeX) * chartW;
  const scaleY = (y: number): number => padTop + chartH - ((y - minY) / rangeY) * chartH;

  const gridY = [0, 0.25, 0.5, 0.75, 1.0]
    .map((ratio) => {
      const val = minY + rangeY * ratio;
      const y = scaleY(val);
      return `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="#333333" stroke-dasharray="2,2"/><text x="${padLeft - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#888888" font-weight="700" font-family="${theme.fontMono}">${val.toFixed(0)}</text>`;
    })
    .join("");

  const polylines = series
    .map((s) => {
      const pts = s.points.map((p) => `${scaleX(p.x).toFixed(1)},${scaleY(p.y).toFixed(1)}`).join(" ");
      return `<polyline points="${pts}" fill="none" stroke="#ffffff" stroke-width="2" stroke-linejoin="miter"/>`;
    })
    .join("");

  const legends = series
    .map((s, idx) => {
      const x = padLeft + idx * 140;
      return `<g transform="translate(${x}, 12)"><line x1="0" y1="4" x2="16" y2="4" stroke="#ffffff" stroke-width="2.5"/><text x="22" y="7" font-size="10" fill="#ffffff" font-weight="800" font-family="${theme.fontMono}">${escapeHtml(s.name.toUpperCase())}</text></g>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="background:#000000;border:2px solid #ffffff;border-radius:0px;box-shadow:4px 4px 0px #ffffff"><g>${gridY}</g>${polylines}<line x1="${padLeft}" y1="${padTop + chartH}" x2="${width - padRight}" y2="${padTop + chartH}" stroke="#ffffff" stroke-width="2"/><line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + chartH}" stroke="#ffffff" stroke-width="2"/><g>${legends}</g></svg>`;
}

export function renderFrameOverview(frame: TrajectoryFrame, theme: ThemeTokens): string {
  return `<div style="display:flex;flex-direction:column;gap:12px;background:#000000;border:2px solid #ffffff;box-shadow:4px 4px 0px #ffffff;padding:16px"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:900;color:#ffffff;font-size:14px;font-family:${theme.fontMono};letter-spacing:0.5px">FRAME #${frame.frameIndex + 1} &bull; TURN #${frame.turnIndex}</span><span style="font-family:${theme.fontMono};font-size:12px;font-weight:700;color:#888888">${(frame.elapsedMs / 1000).toFixed(2)}S ELAPSED</span></div><div style="font-size:13px;color:#ffffff;line-height:1.5;font-family:${theme.fontMono}">${escapeHtml(frame.summary)}</div><div style="display:flex;gap:8px;flex-wrap:wrap">${renderMetricBadge({ label: "EVENT", value: frame.eventType.toUpperCase(), variant: "info" }, theme)}${frame.totalCostUSD !== undefined ? renderMetricBadge({ label: "COST", value: `$${frame.totalCostUSD.toFixed(4)}`, variant: "warning" }, theme) : ""}${frame.totalTokens !== undefined ? renderMetricBadge({ label: "TOKENS", value: frame.totalTokens, variant: "neutral" }, theme) : ""}</div></div>`;
}

export function renderToolCallViewer(toolCall: ToolCallEvent, theme: ThemeTokens): string {
  return `<div style="display:flex;flex-direction:column;gap:8px;background:#000000;border:2px solid #ffffff;box-shadow:4px 4px 0px #ffffff;padding:16px"><div style="font-size:13px;font-weight:900;color:#ffffff;font-family:${theme.fontMono};text-transform:uppercase">TOOL: ${escapeHtml(toolCall.toolName)} <span style="font-weight:700;color:#888888;font-size:11px">(${escapeHtml(toolCall.callId)})</span></div><div style="background:#111111;padding:10px;border-radius:0px;font-family:${theme.fontMono};font-size:12px;color:#ffffff;max-height:180px;overflow-y:auto;border:1px solid #ffffff">${escapeHtml(JSON.stringify(toolCall.inputPayload, null, 2))}</div>${toolCall.stdout ? `<div style="font-size:11px;font-weight:800;color:#888888;font-family:${theme.fontMono}">OUTPUT:</div><div style="background:#111111;padding:10px;border-radius:0px;font-family:${theme.fontMono};font-size:12px;color:#ffffff;max-height:180px;overflow-y:auto;border:1px solid #ffffff">${escapeHtml(toolCall.stdout)}</div>` : ""}${toolCall.stderr ? `<div style="font-size:11px;font-weight:800;color:#ffffff;font-family:${theme.fontMono}">ERROR:</div><div style="background:#000000;padding:10px;border-radius:0px;font-family:${theme.fontMono};font-size:12px;color:#ffffff;border:2px solid #ffffff">${escapeHtml(toolCall.stderr)}</div>` : ""}</div>`;
}

export function renderThinkingViewer(thinking: ThinkingEvent, theme: ThemeTokens): string {
  return `<div style="display:flex;flex-direction:column;gap:8px;background:#000000;border:2px solid #ffffff;box-shadow:4px 4px 0px #ffffff;padding:16px"><div style="font-size:13px;font-weight:900;color:#ffffff;font-family:${theme.fontMono};text-transform:uppercase">REASONING STREAM <span style="font-weight:700;color:#888888;font-size:11px">(${thinking.tokenCount} TOKENS)</span></div><div style="background:#111111;padding:12px;border-radius:0px;font-family:${theme.fontMono};font-size:12px;line-height:1.5;color:#ffffff;max-height:260px;overflow-y:auto;border:1px solid #ffffff;white-space:pre-wrap">${escapeHtml(thinking.thoughtChunk)}</div></div>`;
}

export function renderScatterPlotSvg(points: readonly ChartPoint[], theme: ThemeTokens, width = 600, height = 240): string {
  const pad = 40;
  const maxVal = Math.max(1, ...points.map((p) => p.value));
  const dots = points
    .map((pt, idx) => {
      const cx = pad + (idx / Math.max(1, points.length - 1)) * (width - pad * 2);
      const cy = height - pad - (pt.value / maxVal) * (height - pad * 2);
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="#ffffff" stroke="#000000" stroke-width="2"/>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="background:#000000;border:2px solid #ffffff;border-radius:0px;box-shadow:4px 4px 0px #ffffff"><line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#ffffff" stroke-width="2"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#ffffff" stroke-width="2"/><g>${dots}</g></svg>`;
}

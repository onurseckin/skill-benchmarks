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
    success: { bg: theme.successBg, color: theme.success, border: theme.success },
    warning: { bg: theme.warningBg, color: theme.warning, border: theme.warning },
    error: { bg: theme.errorBg, color: theme.error, border: theme.error },
    info: { bg: theme.primaryAlpha, color: theme.primary, border: theme.primary },
    neutral: { bg: theme.surfaceAlt, color: theme.textMuted, border: theme.border },
    primary: { bg: theme.primaryAlpha, color: theme.primary, border: theme.primary },
    mauve: { bg: "rgba(192, 132, 252, 0.15)", color: theme.mauve, border: theme.mauve },
    cyan: { bg: "rgba(34, 211, 238, 0.15)", color: theme.cyan, border: theme.cyan },
  };

  const style = variantStyles[badge.variant] ?? variantStyles.neutral;
  const deltaHtml = badge.delta
    ? `<span style="font-size:10px;margin-left:4px;color:${badge.deltaPositive ? theme.success : theme.error}">${escapeHtml(badge.delta)}</span>`
    : "";
  const iconHtml = badge.icon ? `<span style="margin-right:4px">${escapeHtml(badge.icon)}</span>` : "";

  return `<span class="badge" title="${escapeHtml(badge.tooltip ?? badge.label)}" style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${style.bg};color:${style.color};border:1px solid ${style.border};font-family:${theme.fontMono}">${iconHtml}${escapeHtml(badge.label)}: ${escapeHtml(String(badge.value))}${deltaHtml}</span>`;
}

export function renderKpiCard(kpi: KpiCardModel, theme: ThemeTokens): string {
  return `<div class="kpi-card" style="background:${theme.surface};border:1px solid ${theme.border};border-radius:8px;padding:16px 20px;display:flex;flex-direction:column;gap:6px"><div style="font-size:12px;font-weight:600;text-transform:uppercase;color:${theme.textMuted};letter-spacing:0.5px">${escapeHtml(kpi.title)}</div><div style="font-size:26px;font-weight:700;color:${theme.text};font-family:${theme.fontMono}">${escapeHtml(String(kpi.value))}</div>${kpi.subtitle ? `<div style="font-size:11px;color:${theme.textDim}">${escapeHtml(kpi.subtitle)}</div>` : ""}</div>`;
}

export function renderNavbar(activeView: AppView, theme: ThemeTokens, isLiveConnected: boolean): string {
  const views: readonly { id: AppView; label: string }[] = [
    { id: "leaderboard", label: "Leaderboard" },
    { id: "replay", label: "Replay Player" },
    { id: "live", label: "Live Telemetry" },
    { id: "analytics", label: "Analytics" },
    { id: "runs", label: "All Runs" },
  ];

  const links = views
    .map((v) => {
      const active = v.id === activeView;
      const bg = active ? theme.primaryAlpha : "transparent";
      const color = active ? theme.primary : theme.textMuted;
      const border = active ? `border-bottom: 2px solid ${theme.primary};` : "";
      return `<button class="nav-tab" onclick="appSetView('${v.id}')" style="background:${bg};color:${color};border:none;padding:10px 16px;cursor:pointer;font-size:13px;font-weight:600;border-radius:4px 4px 0 0;${border}">${escapeHtml(v.label)}</button>`;
    })
    .join("");

  const liveBadge = isLiveConnected
    ? `<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:${theme.success};font-weight:600"><span style="width:8px;height:8px;border-radius:50%;background:${theme.success};display:inline-block"></span>Live Connected</span>`
    : `<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:${theme.textDim}"><span style="width:8px;height:8px;border-radius:50%;background:${theme.textDim};display:inline-block"></span>Offline</span>`;

  return `<header style="background:${theme.surface};border-bottom:1px solid ${theme.border};padding:0 24px;display:flex;justify-content:space-between;align-items:center;height:56px"><div style="display:flex;align-items:center;gap:20px"><div style="font-size:16px;font-weight:700;color:${theme.primary};display:flex;align-items:center;gap:8px"><span>⚡</span><span>Skill Benchmarks</span></div><nav style="display:flex;gap:4px">${links}</nav></div><div style="display:flex;align-items:center;gap:16px">${liveBadge}<select onchange="appSetTheme(this.value)" style="background:${theme.bgSecondary};border:1px solid ${theme.border};color:${theme.text};padding:4px 10px;border-radius:4px;font-size:12px"><option value="dark">Dark</option><option value="light">Light</option><option value="high-contrast">High Contrast</option><option value="cyberpunk">Cyberpunk</option><option value="monochrome">Monochrome</option></select></div></header>`;
}

export function renderLeaderboardTable(model: LeaderboardViewModel, theme: ThemeTokens): string {
  const { categories, activeCategory, searchFilter, sortKey, sortDirection, entries } = model;

  const catOptions = ["all", ...categories]
    .map((c) => `<option value="${escapeHtml(c)}" ${c === activeCategory ? "selected" : ""}>${c === "all" ? "All Categories" : escapeHtml(c)}</option>`)
    .join("");

  const cols: readonly { key: typeof sortKey; label: string }[] = [
    { key: "rank", label: "Rank" },
    { key: "skillId", label: "Skill ID" },
    { key: "category", label: "Category" },
    { key: "passRate", label: "Pass Rate" },
    { key: "averageScore", label: "Score" },
    { key: "eloRating", label: "Elo" },
    { key: "meanDurationSeconds", label: "Duration" },
    { key: "averageCostUSD", label: "Cost" },
    { key: "cacheHitRatio", label: "Cache Hit" },
    { key: "totalRuns", label: "Runs" },
  ];

  const ths = cols
    .map((c) => {
      const isSorted = c.key === sortKey;
      const arrow = isSorted ? (sortDirection === "asc" ? " ▲" : " ▼") : "";
      return `<th onclick="appSortLeaderboard('${c.key}')" style="background:${theme.surfaceAlt};color:${isSorted ? theme.primary : theme.textMuted};font-weight:600;padding:10px 14px;text-align:left;cursor:pointer;border-bottom:1px solid ${theme.borderStrong};white-space:nowrap;font-size:12px;user-select:none">${escapeHtml(c.label)}${arrow}</th>`;
    })
    .join("");

  const rows = entries
    .map((e) => {
      const isSelected = e.skillId === model.selectedSkillId;
      const rowBg = isSelected ? theme.primaryAlpha : "transparent";
      const passColor = e.passRate >= 80 ? theme.success : e.passRate >= 50 ? theme.warning : theme.error;
      const cachePct = (e.cacheHitRatio * (e.cacheHitRatio <= 1 ? 100 : 1)).toFixed(1);

      return `<tr onclick="appSelectSkill('${escapeHtml(e.skillId)}')" style="background:${rowBg};cursor:pointer;border-bottom:1px solid ${theme.border}"><td style="padding:10px 14px;font-family:${theme.fontMono}">#${e.rank}</td><td style="padding:10px 14px;font-weight:600;color:${theme.primary}">${escapeHtml(e.skillId)}</td><td style="padding:10px 14px"><span style="background:${theme.surfaceAlt};border:1px solid ${theme.border};padding:2px 8px;border-radius:4px;font-size:11px">${escapeHtml(e.category)}</span></td><td style="padding:10px 14px;font-family:${theme.fontMono};color:${passColor};font-weight:600">${e.passRate.toFixed(1)}%</td><td style="padding:10px 14px;font-family:${theme.fontMono}">${e.averageScore.toFixed(3)}</td><td style="padding:10px 14px;font-family:${theme.fontMono};font-weight:600">${Math.round(e.eloRating)}</td><td style="padding:10px 14px;font-family:${theme.fontMono}">${e.meanDurationSeconds.toFixed(2)}s</td><td style="padding:10px 14px;font-family:${theme.fontMono}">$${e.averageCostUSD.toFixed(4)}</td><td style="padding:10px 14px;font-family:${theme.fontMono}">${cachePct}%</td><td style="padding:10px 14px;font-family:${theme.fontMono}">${e.totalRuns}</td></tr>`;
    })
    .join("");

  return `<div class="leaderboard-container" style="display:flex;flex-direction:column;gap:16px"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><select onchange="appFilterCategory(this.value)" style="background:${theme.surface};border:1px solid ${theme.border};color:${theme.text};padding:8px 12px;border-radius:6px;font-size:13px">${catOptions}</select><input type="text" placeholder="Filter skills or categories..." value="${escapeHtml(searchFilter)}" oninput="appSearchLeaderboard(this.value)" style="background:${theme.surface};border:1px solid ${theme.border};color:${theme.text};padding:8px 14px;border-radius:6px;font-size:13px;flex:1;min-width:240px"/></div><div style="overflow-x:auto;border:1px solid ${theme.border};border-radius:8px"><table style="width:100%;border-collapse:collapse;font-size:13px;background:${theme.surface}"><thead><tr>${ths}</tr></thead><tbody>${rows.length > 0 ? rows : `<tr><td colspan="10" style="padding:24px;text-align:center;color:${theme.textDim}">No skills match the current filter.</td></tr>`}</tbody></table></div></div>`;
}

export function renderTrajectoryScrubber(model: ReplayViewModel, theme: ThemeTokens): string {
  const { session, currentFrameIndex, isPlaying, playbackSpeed } = model;
  const frames = session?.frames ?? [];
  const total = frames.length;

  return `<div class="scrubber-bar" style="background:${theme.surface};border-top:1px solid ${theme.border};padding:12px 20px;display:flex;align-items:center;gap:12px"><button onclick="appTogglePlay()" style="background:${isPlaying ? theme.error : theme.primary};color:${theme.bg};border:none;padding:6px 14px;border-radius:4px;font-weight:600;cursor:pointer;font-size:12px">${isPlaying ? "Pause" : "Play"}</button><button onclick="appStepFrame(-1)" style="background:${theme.surfaceAlt};color:${theme.text};border:1px solid ${theme.border};padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer">Prev</button><input type="range" min="0" max="${Math.max(0, total - 1)}" value="${currentFrameIndex}" oninput="appSeekFrame(parseInt(this.value, 10))" style="flex:1;accent-color:${theme.primary};cursor:pointer"/><button onclick="appStepFrame(1)" style="background:${theme.surfaceAlt};color:${theme.text};border:1px solid ${theme.border};padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer">Next</button><span style="font-family:${theme.fontMono};font-size:12px;color:${theme.textMuted};min-width:80px;text-align:right">${currentFrameIndex + 1} / ${total || 1}</span><select onchange="appSetPlaybackSpeed(parseFloat(this.value))" style="background:${theme.surfaceAlt};border:1px solid ${theme.border};color:${theme.text};padding:6px 8px;border-radius:4px;font-size:12px"><option value="0.5" ${playbackSpeed === 0.5 ? "selected" : ""}>0.5x</option><option value="1" ${playbackSpeed === 1 ? "selected" : ""}>1.0x</option><option value="2" ${playbackSpeed === 2 ? "selected" : ""}>2.0x</option><option value="5" ${playbackSpeed === 5 ? "selected" : ""}>5.0x</option></select></div>`;
}

export function renderDiffViewer(diff: DiffViewModel, theme: ThemeTokens): string {
  const lineHtmls = diff.lines
    .map((l) => {
      let bg = "transparent";
      let color = theme.text;
      let sign = " ";
      if (l.type === "add") {
        bg = theme.successBg;
        color = theme.success;
        sign = "+";
      } else if (l.type === "del") {
        bg = theme.errorBg;
        color = theme.error;
        sign = "-";
      } else if (l.type === "header") {
        bg = theme.surfaceAlt;
        color = theme.cyan;
        sign = "@";
      }

      return `<div style="background:${bg};color:${color};display:flex;padding:1px 8px;font-family:${theme.fontMono};font-size:12px;line-height:1.4"><span style="width:40px;color:${theme.textDim};user-select:none;text-align:right;padding-right:8px">${l.oldLineNumber ?? ""}</span><span style="width:40px;color:${theme.textDim};user-select:none;text-align:right;padding-right:8px">${l.newLineNumber ?? ""}</span><span style="width:16px;user-select:none">${sign}</span><span style="flex:1;white-space:pre-wrap;word-break:break-all">${escapeHtml(l.content)}</span></div>`;
    })
    .join("");

  return `<div class="diff-viewer" style="background:${theme.bgSecondary};border:1px solid ${theme.border};border-radius:6px;overflow:hidden"><div style="background:${theme.surface};padding:8px 14px;border-bottom:1px solid ${theme.border};display:flex;justify-content:space-between;align-items:center"><span style="font-family:${theme.fontMono};font-weight:600;font-size:13px;color:${theme.primary}">${escapeHtml(diff.path)}</span><span style="font-size:12px"><span style="color:${theme.success}">+${diff.insertions}</span> <span style="color:${theme.error}">-${diff.deletions}</span></span></div><div style="max-height:400px;overflow-y:auto">${lineHtmls}</div></div>`;
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
      return `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="${theme.border}" stroke-dasharray="2,2"/><text x="${padLeft - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="${theme.textDim}" font-family="${theme.fontMono}">${val.toFixed(0)}</text>`;
    })
    .join("");

  const polylines = series
    .map((s) => {
      const pts = s.points.map((p) => `${scaleX(p.x).toFixed(1)},${scaleY(p.y).toFixed(1)}`).join(" ");
      return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    })
    .join("");

  const legends = series
    .map((s, idx) => {
      const x = padLeft + idx * 140;
      return `<g transform="translate(${x}, 12)"><line x1="0" y1="4" x2="16" y2="4" stroke="${s.color}" stroke-width="2.5"/><text x="22" y="7" font-size="10" fill="${s.color}" font-weight="600" font-family="${theme.fontSans}">${escapeHtml(s.name)}</text></g>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="background:${theme.bgSecondary};border-radius:6px;border:1px solid ${theme.border}"><g>${gridY}</g>${polylines}<line x1="${padLeft}" y1="${padTop + chartH}" x2="${width - padRight}" y2="${padTop + chartH}" stroke="${theme.borderStrong}"/><line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + chartH}" stroke="${theme.borderStrong}"/><g>${legends}</g></svg>`;
}

export function renderFrameOverview(frame: TrajectoryFrame, theme: ThemeTokens): string {
  return `<div style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700;color:${theme.primary};font-size:14px">Frame #${frame.frameIndex + 1} &bull; Turn #${frame.turnIndex}</span><span style="font-family:${theme.fontMono};font-size:12px;color:${theme.textMuted}">${(frame.elapsedMs / 1000).toFixed(2)}s elapsed</span></div><div style="font-size:13px;color:${theme.text};line-height:1.5">${escapeHtml(frame.summary)}</div><div style="display:flex;gap:8px;flex-wrap:wrap">${renderMetricBadge({ label: "Event", value: frame.eventType.toUpperCase(), variant: "info" }, theme)}${frame.totalCostUSD !== undefined ? renderMetricBadge({ label: "Cost", value: `$${frame.totalCostUSD.toFixed(4)}`, variant: "warning" }, theme) : ""}${frame.totalTokens !== undefined ? renderMetricBadge({ label: "Tokens", value: frame.totalTokens, variant: "neutral" }, theme) : ""}</div></div>`;
}

export function renderToolCallViewer(toolCall: ToolCallEvent, theme: ThemeTokens): string {
  return `<div style="display:flex;flex-direction:column;gap:8px"><div style="font-size:13px;font-weight:700;color:${theme.cyan}">Tool: ${escapeHtml(toolCall.toolName)} <span style="font-weight:400;color:${theme.textDim};font-size:11px">(${escapeHtml(toolCall.callId)})</span></div><div style="background:${theme.bgSecondary};padding:10px;border-radius:6px;font-family:${theme.fontMono};font-size:12px;color:${theme.text};max-height:180px;overflow-y:auto;border:1px solid ${theme.border}">${escapeHtml(JSON.stringify(toolCall.inputPayload, null, 2))}</div>${toolCall.stdout ? `<div style="font-size:11px;font-weight:600;color:${theme.textMuted}">Output:</div><div style="background:${theme.bgSecondary};padding:10px;border-radius:6px;font-family:${theme.fontMono};font-size:12px;color:${theme.text};max-height:180px;overflow-y:auto;border:1px solid ${theme.border}">${escapeHtml(toolCall.stdout)}</div>` : ""}${toolCall.stderr ? `<div style="font-size:11px;font-weight:600;color:${theme.error}">Error:</div><div style="background:${theme.bgSecondary};padding:10px;border-radius:6px;font-family:${theme.fontMono};font-size:12px;color:${theme.error};border:1px solid ${theme.error}">${escapeHtml(toolCall.stderr)}</div>` : ""}</div>`;
}

export function renderThinkingViewer(thinking: ThinkingEvent, theme: ThemeTokens): string {
  return `<div style="display:flex;flex-direction:column;gap:8px"><div style="font-size:13px;font-weight:700;color:${theme.mauve}">Reasoning Stream <span style="font-weight:400;color:${theme.textDim};font-size:11px">(${thinking.tokenCount} tokens)</span></div><div style="background:${theme.bgSecondary};padding:12px;border-radius:6px;font-family:${theme.fontMono};font-size:12px;line-height:1.5;color:${theme.text};max-height:260px;overflow-y:auto;border:1px solid ${theme.border};white-space:pre-wrap">${escapeHtml(thinking.thoughtChunk)}</div></div>`;
}

export function renderScatterPlotSvg(points: readonly ChartPoint[], theme: ThemeTokens, width = 600, height = 240): string {
  const pad = 40;
  const maxVal = Math.max(1, ...points.map((p) => p.value));
  const dots = points
    .map((pt, idx) => {
      const cx = pad + (idx / Math.max(1, points.length - 1)) * (width - pad * 2);
      const cy = height - pad - (pt.value / maxVal) * (height - pad * 2);
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${theme.primary}" stroke="${theme.bg}" stroke-width="1.5"/>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="background:${theme.bgSecondary};border-radius:6px;border:1px solid ${theme.border}"><line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="${theme.borderStrong}"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="${theme.borderStrong}"/><g>${dots}</g></svg>`;
}

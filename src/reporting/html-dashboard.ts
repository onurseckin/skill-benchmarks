import type {
  CostEfficiencyPoint,
  LeaderboardEntry,
  SkillBenchmarkSummary,
} from "./types.js";

export interface DashboardMetadata {
  readonly totalRuns?: number;
  readonly lastUpdated?: string;
  readonly title?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderScatterPlot(
  costPoints: readonly CostEfficiencyPoint[],
  summaries: readonly SkillBenchmarkSummary[]
): string {
  const points: readonly CostEfficiencyPoint[] =
    costPoints.length > 0
      ? costPoints
      : summaries.map((s) => ({
          skillId: s.skillId,
          modelId: "all",
          averageCostUSD: s.averageCostUSD,
          compositeScore: s.averageScore,
          passRate: s.passRate,
          tokensPerTask: 0,
          durationMs: s.meanDurationMs,
        }));

  const maxCost = Math.max(0.001, ...points.map((p) => p.averageCostUSD)) * 1.15;
  const scaleX = (cost: number): number => 60 + (Math.max(0, cost) / maxCost) * 560;
  const scaleY = (pass: number): number => 270 - (Math.max(0, Math.min(100, pass)) / 100) * 240;

  const sortedForFrontier = [...points].sort((a, b) =>
    a.averageCostUSD !== b.averageCostUSD
      ? a.averageCostUSD - b.averageCostUSD
      : b.passRate - a.passRate
  );
  let maxPass = -1;
  const frontierPoints: CostEfficiencyPoint[] = [];
  for (const pt of sortedForFrontier) {
    if (pt.passRate > maxPass) {
      frontierPoints.push(pt);
      maxPass = pt.passRate;
    }
  }

  const frontierPolyline = frontierPoints
    .map((pt) => `${scaleX(pt.averageCostUSD).toFixed(1)},${scaleY(pt.passRate).toFixed(1)}`)
    .join(" ");

  const gridY = [0, 25, 50, 75, 100]
    .map((pct) => {
      const y = scaleY(pct);
      return `<line x1="60" y1="${y}" x2="620" y2="${y}" stroke="#1e293b" stroke-dasharray="2,2"/><text x="52" y="${y + 4}" text-anchor="end" font-size="10" fill="#64748b">${pct}%</text>`;
    })
    .join("");

  const gridX = [0, 0.25, 0.5, 0.75, 1.0]
    .map((ratio) => {
      const cost = maxCost * ratio;
      const x = scaleX(cost);
      return `<line x1="${x}" y1="30" x2="${x}" y2="270" stroke="#1e293b" stroke-dasharray="2,2"/><text x="${x}" y="285" text-anchor="middle" font-size="10" fill="#64748b">$${cost.toFixed(3)}</text>`;
    })
    .join("");

  const dots = points
    .map((pt) => {
      const cx = scaleX(pt.averageCostUSD).toFixed(1);
      const cy = scaleY(pt.passRate).toFixed(1);
      return `<circle cx="${cx}" cy="${cy}" r="5" fill="#38bdf8" stroke="#0f172a" stroke-width="1.5" class="scatter-point" data-skill="${escapeHtml(pt.skillId)}" data-cost="${pt.averageCostUSD.toFixed(4)}" data-pass="${pt.passRate.toFixed(1)}"/>`;
    })
    .join("");

  const frontierSvg =
    frontierPoints.length > 1
      ? `<polyline points="${frontierPolyline}" fill="none" stroke="#34d399" stroke-width="2" stroke-dasharray="4,4"/>`
      : "";

  return `<svg viewBox="0 0 650 320" width="100%" height="280" class="chart-svg"><g>${gridY}${gridX}</g>${frontierSvg}<g>${dots}</g><line x1="60" y1="270" x2="620" y2="270" stroke="#475569"/><line x1="60" y1="30" x2="60" y2="270" stroke="#475569"/><text x="340" y="308" text-anchor="middle" font-size="11" fill="#94a3b8">Average Cost (USD)</text><text x="18" y="150" text-anchor="middle" transform="rotate(-90, 18, 150)" font-size="11" fill="#94a3b8">Pass Rate (%)</text><g transform="translate(480, 20)"><line x1="0" y1="5" x2="16" y2="5" stroke="#34d399" stroke-width="2" stroke-dasharray="4,4"/><text x="22" y="8" font-size="10" fill="#94a3b8">Pareto Frontier</text></g></svg>`;
}

function renderBarChart(summaries: readonly SkillBenchmarkSummary[]): string {
  const topSummaries = summaries.slice(0, 10);
  const count = Math.max(1, topSummaries.length);
  const step = 560 / count;
  const barWidth = Math.min(36, step * 0.6);

  const gridY = [0, 25, 50, 75, 100]
    .map((pct) => {
      const y = 260 - (pct / 100) * 230;
      return `<line x1="60" y1="${y}" x2="620" y2="${y}" stroke="#1e293b" stroke-dasharray="2,2"/><text x="52" y="${y + 4}" text-anchor="end" font-size="10" fill="#64748b">${pct}%</text>`;
    })
    .join("");

  const bars = topSummaries
    .map((s, idx) => {
      const xc = 60 + step * idx + step / 2;
      const xb = xc - barWidth / 2;
      const p = Math.max(0, Math.min(100, s.passRate));
      const h = (p / 100) * 230;
      const yb = 260 - h;

      const n = Math.max(1, s.totalRuns);
      const pDec = p / 100;
      const margin = 1.96 * Math.sqrt(Math.max(0, (pDec * (1 - pDec)) / n)) * 100;
      const ci = s.scoreStats?.confidenceInterval95;
      const ciLow = ci ? Math.max(0, ci[0] * (ci[1] <= 1 ? 100 : 1)) : Math.max(0, p - margin);
      const ciHigh = ci ? Math.min(100, ci[1] * (ci[1] <= 1 ? 100 : 1)) : Math.min(100, p + margin);

      const yHigh = 260 - (ciHigh / 100) * 230;
      const yLow = 260 - (ciLow / 100) * 230;
      const displayLabel = s.skillId.length > 12 ? `${s.skillId.slice(0, 10)}..` : s.skillId;

      return `<g><rect x="${xb.toFixed(1)}" y="${yb.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="#818cf8" class="chart-bar" data-skill="${escapeHtml(s.skillId)}" data-pass="${p.toFixed(1)}" data-ci="[${ciLow.toFixed(1)}%, ${ciHigh.toFixed(1)}%]"/><line x1="${xc.toFixed(1)}" y1="${yHigh.toFixed(1)}" x2="${xc.toFixed(1)}" y2="${yLow.toFixed(1)}" stroke="#f43f5e" stroke-width="2"/><line x1="${(xc - 4).toFixed(1)}" y1="${yHigh.toFixed(1)}" x2="${(xc + 4).toFixed(1)}" y2="${yHigh.toFixed(1)}" stroke="#f43f5e" stroke-width="2"/><line x1="${(xc - 4).toFixed(1)}" y1="${yLow.toFixed(1)}" x2="${(xc + 4).toFixed(1)}" y2="${yLow.toFixed(1)}" stroke="#f43f5e" stroke-width="2"/><text x="${xc.toFixed(1)}" y="${Math.max(18, yHigh - 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="#e2e8f0">${p.toFixed(0)}%</text><text x="${xc.toFixed(1)}" y="276" text-anchor="end" transform="rotate(-35, ${xc.toFixed(1)}, 276)" font-size="10" fill="#94a3b8">${escapeHtml(displayLabel)}</text></g>`;
    })
    .join("");

  return `<svg viewBox="0 0 650 320" width="100%" height="280" class="chart-svg"><g>${gridY}</g><g>${bars}</g><line x1="60" y1="260" x2="620" y2="260" stroke="#475569"/><line x1="60" y1="30" x2="60" y2="260" stroke="#475569"/><text x="18" y="145" text-anchor="middle" transform="rotate(-90, 18, 145)" font-size="11" fill="#94a3b8">Pass Rate (%)</text><g transform="translate(480, 15)"><line x1="0" y1="5" x2="12" y2="5" stroke="#f43f5e" stroke-width="2"/><text x="18" y="8" font-size="10" fill="#94a3b8">95% Error Bar</text></g></svg>`;
}

function renderLeaderboardRows(entries: readonly LeaderboardEntry[]): string {
  return entries
    .map((e) => {
      const deltaHtml =
        e.passRateDeltaOverControl !== undefined
          ? ` <span class="${e.passRateDeltaOverControl >= 0 ? "text-green" : "text-red"}">(${e.passRateDeltaOverControl >= 0 ? "+" : ""}${e.passRateDeltaOverControl.toFixed(1)}%)</span>`
          : "";
      const sigBadge = e.isStatisticallySignificant
        ? `<span class="badge badge-sig">p &lt; 0.05</span>`
        : `<span class="badge badge-dim">—</span>`;
      const cacheHitPct = (e.cacheHitRatio * (e.cacheHitRatio <= 1 ? 100 : 1)).toFixed(1);

      return `<tr data-category="${escapeHtml(e.category)}"><td>#${e.rank}</td><td><strong>${escapeHtml(e.skillId)}</strong></td><td><span class="badge badge-cat">${escapeHtml(e.category)}</span></td><td>${e.passRate.toFixed(1)}%${deltaHtml}</td><td>${e.averageScore.toFixed(3)}</td><td>${Math.round(e.eloRating)}</td><td>${e.meanDurationSeconds.toFixed(2)}s</td><td>$${e.averageCostUSD.toFixed(4)}</td><td>${cacheHitPct}%</td><td>${e.totalRuns}</td><td>${sigBadge}</td></tr>`;
    })
    .join("");
}

function renderCategoryOptions(entries: readonly LeaderboardEntry[]): string {
  const categories = Array.from(new Set(entries.map((e) => e.category))).sort();
  const options = categories
    .map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`)
    .join("");
  return `<option value="all">All Categories (${entries.length})</option>${options}`;
}

function generateCss(): string {
  return `
html, body, div, span, h1, h2, table, th, td, select, input, header, section, g, text { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #090d16; color: #f1f5f9; padding: 24px; }
.container { max-width: 1400px; margin: 0 auto; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #1e293b; }
.header h1 { font-size: 24px; font-weight: 700; color: #38bdf8; }
.header .badge-time { background: #1e293b; color: #94a3b8; padding: 6px 12px; border-radius: 6px; font-size: 12px; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
.kpi-card { background: #131b2e; border: 1px solid #1e293b; border-radius: 8px; padding: 18px 20px; }
.kpi-title { font-size: 12px; font-weight: 600; text-transform: uppercase; color: #94a3b8; margin-bottom: 6px; }
.kpi-val { font-size: 26px; font-weight: 700; color: #f8fafc; }
.kpi-accent { color: #38bdf8; }
.charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 20px; margin-bottom: 24px; }
.card { background: #131b2e; border: 1px solid #1e293b; border-radius: 8px; padding: 20px; }
.card-title { font-size: 15px; font-weight: 600; color: #e2e8f0; margin-bottom: 14px; }
.controls { display: flex; gap: 16px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.select-input, .text-input { background: #0f172a; border: 1px solid #334155; color: #f1f5f9; padding: 8px 12px; border-radius: 6px; font-size: 13px; outline: none; }
.select-input:focus, .text-input:focus { border-color: #38bdf8; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { background: #1e293b; color: #94a3b8; font-weight: 600; padding: 10px 12px; text-align: left; cursor: pointer; user-select: none; border-bottom: 1px solid #334155; white-space: nowrap; }
th.asc::after { content: " ▲"; color: #38bdf8; }
th.desc::after { content: " ▼"; color: #38bdf8; }
td { padding: 10px 12px; border-bottom: 1px solid #1e293b; color: #cbd5e1; white-space: nowrap; }
tr:hover td { background: rgba(56, 189, 248, 0.04); }
.badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
.badge-cat { background: #1e293b; color: #38bdf8; border: 1px solid #334155; }
.badge-sig { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
.badge-dim { color: #64748b; }
.text-green { color: #34d399; font-size: 11px; }
.text-red { color: #f43f5e; font-size: 11px; }
.scatter-point, .chart-bar { cursor: pointer; transition: transform 0.15s ease, opacity 0.15s ease; }
.scatter-point:hover, .chart-bar:hover { opacity: 0.8; }
.chart-tooltip { position: fixed; display: none; background: #0f172a; border: 1px solid #38bdf8; border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #f8fafc; pointer-events: none; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.5); line-height: 1.4; }
`.trim();
}

function generateScript(): string {
  return `
document.addEventListener("DOMContentLoaded", function () {
  var table = document.getElementById("leaderboardTable");
  if (!table) return;
  var tbody = table.querySelector("tbody");
  var headers = table.querySelectorAll("th.sortable");
  var currentSort = { col: -1, asc: true };

  headers.forEach(function (th) {
    th.addEventListener("click", function () {
      var colIdx = parseInt(th.getAttribute("data-col") || "0", 10);
      var asc = currentSort.col === colIdx ? !currentSort.asc : true;
      currentSort = { col: colIdx, asc: asc };
      headers.forEach(function (h) { h.classList.remove("asc", "desc"); });
      th.classList.add(asc ? "asc" : "desc");

      var rows = Array.from(tbody.querySelectorAll("tr"));
      rows.sort(function (a, b) {
        var aCell = a.children[colIdx];
        var bCell = b.children[colIdx];
        var aVal = aCell ? aCell.innerText.trim() : "";
        var bVal = bCell ? bCell.innerText.trim() : "";
        var aNum = parseFloat(aVal.replace(/[^0-9.-]/g, ""));
        var bNum = parseFloat(bVal.replace(/[^0-9.-]/g, ""));
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return asc ? aNum - bNum : bNum - aNum;
        }
        return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      });
      rows.forEach(function (r) { tbody.appendChild(r); });
    });
  });

  var catFilter = document.getElementById("categoryFilter");
  var searchInput = document.getElementById("skillSearch");
  function applyFilter() {
    var selectedCat = catFilter ? catFilter.value : "all";
    var searchVal = searchInput ? searchInput.value.toLowerCase().trim() : "";
    var rows = tbody.querySelectorAll("tr");
    rows.forEach(function (row) {
      var rowCat = row.getAttribute("data-category") || "";
      var rowText = row.innerText.toLowerCase();
      var matchCat = selectedCat === "all" || rowCat === selectedCat;
      var matchSearch = !searchVal || rowText.indexOf(searchVal) !== -1;
      row.style.display = matchCat && matchSearch ? "" : "none";
    });
  }
  if (catFilter) catFilter.addEventListener("change", applyFilter);
  if (searchInput) searchInput.addEventListener("input", applyFilter);

  var tooltip = document.getElementById("chartTooltip");
  if (tooltip) {
    document.querySelectorAll(".scatter-point, .chart-bar").forEach(function (elem) {
      elem.addEventListener("mouseenter", function (e) {
        var skill = elem.getAttribute("data-skill") || "";
        var pass = elem.getAttribute("data-pass") || "";
        var cost = elem.getAttribute("data-cost");
        var ci = elem.getAttribute("data-ci");
        var html = "<strong>" + skill + "</strong><br/>Pass Rate: " + pass + "%";
        if (cost) html += "<br/>Cost: $" + cost;
        if (ci) html += "<br/>95% CI: " + ci;
        tooltip.innerHTML = html;
        tooltip.style.display = "block";
        tooltip.style.left = (e.clientX + 14) + "px";
        tooltip.style.top = (e.clientY + 14) + "px";
      });
      elem.addEventListener("mousemove", function (e) {
        tooltip.style.left = (e.clientX + 14) + "px";
        tooltip.style.top = (e.clientY + 14) + "px";
      });
      elem.addEventListener("mouseleave", function () {
        tooltip.style.display = "none";
      });
    });
  }
});
`.trim();
}

export function generateHtmlDashboard(
  summaries: readonly SkillBenchmarkSummary[],
  entries: readonly LeaderboardEntry[],
  costPoints: readonly CostEfficiencyPoint[],
  metadata?: DashboardMetadata
): string {
  const title = escapeHtml(metadata?.title ?? "Skill Benchmarks Dashboard");
  const lastUpdated = escapeHtml(metadata?.lastUpdated ?? new Date().toISOString());
  const totalRuns = metadata?.totalRuns ?? entries.reduce((sum, e) => sum + e.totalRuns, 0);
  const topSkill = entries[0]?.skillId ?? "N/A";
  const avgPassRate =
    entries.length > 0
      ? `${(entries.reduce((sum, e) => sum + e.passRate, 0) / entries.length).toFixed(1)}%`
      : "0.0%";
  const avgCacheHit =
    entries.length > 0
      ? `${((entries.reduce((sum, e) => sum + e.cacheHitRatio, 0) / entries.length) * (entries[0]?.cacheHitRatio && entries[0].cacheHitRatio <= 1 ? 100 : 1)).toFixed(1)}%`
      : "0.0%";

  const scatterSvg = renderScatterPlot(costPoints, summaries);
  const barSvg = renderBarChart(summaries);
  const tableRows = renderLeaderboardRows(entries);
  const catOptions = renderCategoryOptions(entries);
  const css = generateCss();
  const script = generateScript();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${title}</title>
<style>${css}</style>
</head>
<body>
<div class="container">
  <header class="header">
    <h1>${title}</h1>
    <span class="badge-time">Last Updated: ${lastUpdated}</span>
  </header>
  <section class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-title">Total Benchmark Runs</div>
      <div class="kpi-val kpi-accent">${totalRuns.toLocaleString()}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">Top Ranked Skill</div>
      <div class="kpi-val">${escapeHtml(topSkill)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">Average Pass Rate</div>
      <div class="kpi-val kpi-accent">${avgPassRate}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">Avg Cache Hit Ratio</div>
      <div class="kpi-val">${avgCacheHit}</div>
    </div>
  </section>
  <section class="charts-grid">
    <div class="card">
      <h2 class="card-title">Cost ($) vs Pass Rate (%) Efficiency Frontier</h2>
      ${scatterSvg}
    </div>
    <div class="card">
      <h2 class="card-title">Top Skills Pass Rate with 95% Confidence Interval</h2>
      ${barSvg}
    </div>
  </section>
  <section class="card">
    <h2 class="card-title">Leaderboard &amp; Performance Metrics</h2>
    <div class="controls">
      <select id="categoryFilter" class="select-input">${catOptions}</select>
      <input type="text" id="skillSearch" class="text-input" placeholder="Filter skills..."/>
    </div>
    <div class="table-wrap">
      <table id="leaderboardTable">
        <thead>
          <tr>
            <th data-col="0" class="sortable">Rank</th>
            <th data-col="1" class="sortable">Skill ID</th>
            <th data-col="2" class="sortable">Category</th>
            <th data-col="3" class="sortable">Pass Rate</th>
            <th data-col="4" class="sortable">Score</th>
            <th data-col="5" class="sortable">Elo</th>
            <th data-col="6" class="sortable">Duration</th>
            <th data-col="7" class="sortable">Cost</th>
            <th data-col="8" class="sortable">Cache Hit</th>
            <th data-col="9" class="sortable">Runs</th>
            <th data-col="10" class="sortable">Stat Sig</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  </section>
</div>
<div id="chartTooltip" class="chart-tooltip"></div>
<script>${script}</script>
</body>
</html>`;
}

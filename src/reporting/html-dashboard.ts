import type {
  CostEfficiencyPoint,
  LeaderboardEntry,
  SkillBenchmarkSummary,
} from "./types.js";
import {
  renderBarChart,
  renderLatencyPercentilesBarChart,
  renderScatterPlot,
  renderTokenVelocityOverviewChart,
} from "./dashboard-charts.js";

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
      const modelLabel = e.modelId ? escapeHtml(e.modelId) : "DEFAULT";
      const thinkBadge =
        e.thinkingLevel && e.thinkingLevel !== "none"
          ? `<span class="badge badge-think">${escapeHtml(e.thinkingLevel.toUpperCase())}</span>`
          : `<span class="badge badge-dim">OFF</span>`;
      const reasoningTokens = e.reasoningTokens ? e.reasoningTokens.toLocaleString() : "—";

      return `<tr data-category="${escapeHtml(e.category)}" data-skill="${escapeHtml(e.skillId)}" data-model="${modelLabel.toLowerCase()}" data-tier="${escapeHtml(e.modelTier ?? "flagship")}" data-think="${escapeHtml(e.thinkingLevel ?? "none")}" data-pass="${e.passRate.toFixed(1)}"><td>#${e.rank}</td><td><strong>${modelLabel}</strong></td><td>${thinkBadge}</td><td><strong>${escapeHtml(e.skillId)}</strong></td><td><span class="badge badge-cat">${escapeHtml(e.category)}</span></td><td>${e.passRate.toFixed(1)}%${deltaHtml}</td><td>${e.averageScore.toFixed(3)}</td><td>${Math.round(e.eloRating)}</td><td>${e.meanDurationSeconds.toFixed(2)}s</td><td>$${e.averageCostUSD.toFixed(4)}</td><td>${cacheHitPct}%</td><td>${reasoningTokens}</td><td>${e.totalRuns}</td><td>${sigBadge}</td></tr>`;
    })
    .join("");
}

function renderCategoryOptions(entries: readonly LeaderboardEntry[]): string {
  const categories = Array.from(new Set(entries.map((e) => e.category))).sort();
  const options = categories
    .map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat.toUpperCase())}</option>`)
    .join("");
  return `<option value="all">ALL CATEGORIES (${entries.length})</option>${options}`;
}

function generateCss(): string {
  return `
html, body, div, span, h1, h2, table, th, td, select, input, header, section, g, text { box-sizing: border-box; margin: 0; padding: 0; font-family: "JetBrains Mono", "Fira Code", monospace; }
body { background: #000000; color: #ffffff; padding: 16px; width: 100vw; min-height: 100vh; }
.full-viewport-container { width: 100%; max-width: 100%; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
.header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border: 2px solid #ffffff; box-shadow: 4px 4px 0px #ffffff; background: #000000; flex-wrap: wrap; gap: 12px; }
.header h1 { font-size: 20px; font-weight: 900; color: #ffffff; text-transform: uppercase; letter-spacing: 1px; }
.header .badge-time { background: #000000; color: #ffffff; padding: 4px 10px; border: 1px solid #ffffff; font-size: 11px; font-weight: 700; }
.filter-toolbar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 16px; border: 2px solid #ffffff; box-shadow: 4px 4px 0px #ffffff; background: #000000; }
.filter-label { font-size: 11px; font-weight: 900; text-transform: uppercase; color: #888888; letter-spacing: 0.5px; }
.select-input, .text-input { background: #000000; border: 2px solid #ffffff; color: #ffffff; padding: 8px 12px; font-size: 11px; font-weight: 700; outline: none; box-shadow: 2px 2px 0px #ffffff; }
.select-input:focus, .text-input:focus { background: #111111; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
.kpi-card { background: #000000; border: 2px solid #ffffff; box-shadow: 4px 4px 0px #ffffff; padding: 16px 18px; }
.kpi-title { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #888888; letter-spacing: 1px; margin-bottom: 6px; }
.kpi-val { font-size: 24px; font-weight: 900; color: #ffffff; letter-spacing: -0.5px; }
.kpi-accent { color: #ffffff; }
.charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(460px, 1fr)); gap: 16px; }
.card { background: #000000; border: 2px solid #ffffff; box-shadow: 4px 4px 0px #ffffff; padding: 16px; }
.card-title { font-size: 13px; font-weight: 900; color: #ffffff; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
.table-wrap { overflow-x: auto; border: 2px solid #ffffff; box-shadow: 4px 4px 0px #ffffff; width: 100%; }
table { width: 100%; border-collapse: collapse; font-size: 12px; background: #000000; }
th { background: #ffffff; color: #000000; font-weight: 900; padding: 10px 12px; text-align: left; cursor: pointer; user-select: none; border-bottom: 2px solid #ffffff; border-right: 1px solid #000000; white-space: nowrap; letter-spacing: 0.5px; }
th.asc::after { content: " ▲"; color: #000000; }
th.desc::after { content: " ▼"; color: #000000; }
td { padding: 9px 12px; border-bottom: 1px solid #333333; color: #ffffff; white-space: nowrap; font-weight: 600; }
tr:hover td { background: #222222; }
.badge { display: inline-block; padding: 2px 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
.badge-cat { background: #000000; color: #ffffff; border: 1px solid #ffffff; }
.badge-sig { background: #ffffff; color: #000000; font-weight: 900; }
.badge-dim { color: #888888; border: 1px solid #555555; }
.badge-think { background: #ffffff; color: #000000; font-weight: 900; border: 1px solid #ffffff; }
.text-green { color: #ffffff; font-size: 11px; font-weight: 700; }
.text-red { color: #888888; font-size: 11px; font-weight: 700; }
.scatter-point, .chart-bar { cursor: pointer; }
.scatter-point:hover, .chart-bar:hover { opacity: 0.7; }
.chart-tooltip { position: fixed; display: none; background: #000000; border: 2px solid #ffffff; padding: 8px 12px; font-size: 11px; color: #ffffff; pointer-events: none; z-index: 1000; box-shadow: 4px 4px 0px #ffffff; line-height: 1.4; font-weight: 700; }
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
  var tierFilter = document.getElementById("tierFilter");
  var thinkFilter = document.getElementById("thinkFilter");
  var statusFilter = document.getElementById("statusFilter");
  var searchInput = document.getElementById("skillSearch");

  function applyFilter() {
    var selectedCat = catFilter ? catFilter.value : "all";
    var selectedTier = tierFilter ? tierFilter.value : "all";
    var selectedThink = thinkFilter ? thinkFilter.value : "all";
    var selectedStatus = statusFilter ? statusFilter.value : "all";
    var searchVal = searchInput ? searchInput.value.toLowerCase().trim() : "";
    var rows = tbody.querySelectorAll("tr");

    rows.forEach(function (row) {
      var rowCat = row.getAttribute("data-category") || "";
      var rowTier = row.getAttribute("data-tier") || "flagship";
      var rowThink = row.getAttribute("data-think") || "none";
      var rowPass = parseFloat(row.getAttribute("data-pass") || "100");
      var rowText = row.innerText.toLowerCase();
      var matchCat = selectedCat === "all" || rowCat === selectedCat;
      var matchTier = selectedTier === "all" || rowTier === selectedTier;
      var matchThink = selectedThink === "all" || (selectedThink === "none" ? rowThink === "none" || rowThink === "off" : rowThink === selectedThink);
      var matchStatus = selectedStatus === "all" || (selectedStatus === "pass" ? rowPass >= 70 : rowPass < 70);
      var matchSearch = !searchVal || rowText.indexOf(searchVal) !== -1;
      row.style.display = matchCat && matchTier && matchThink && matchStatus && matchSearch ? "" : "none";
    });
  }

  if (catFilter) catFilter.addEventListener("change", applyFilter);
  if (tierFilter) tierFilter.addEventListener("change", applyFilter);
  if (thinkFilter) thinkFilter.addEventListener("change", applyFilter);
  if (statusFilter) statusFilter.addEventListener("change", applyFilter);
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
  const velocities = summaries.map((s) => ({
    skillId: s.skillId,
    tokensPerSec: s.meanDurationMs > 0 ? Math.max(10, Math.round(2000 / (s.meanDurationMs / 1000))) : 50,
  }));
  const velocitySvg = renderTokenVelocityOverviewChart(velocities);
  const latencySvg = renderLatencyPercentilesBarChart(210, 680, 1320);
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
<div class="full-viewport-container">
  <header class="header">
    <h1>⚡ ${title}</h1>
    <span class="badge-time">LAST UPDATED: ${lastUpdated}</span>
  </header>
  <section class="filter-toolbar">
    <span class="filter-label">FILTERS:</span>
    <select id="categoryFilter" class="select-input">${catOptions}</select>
    <select id="tierFilter" class="select-input">
      <option value="all">ALL TIERS</option>
      <option value="flagship">FLAGSHIP</option>
      <option value="mid">MID-SIZE</option>
      <option value="small">SMALL/FAST</option>
    </select>
    <select id="thinkFilter" class="select-input">
      <option value="all">ALL THINKING LEVELS</option>
      <option value="none">NONE (NON-THINKING)</option>
      <option value="low">LOW THINKING</option>
      <option value="medium">MEDIUM THINKING</option>
      <option value="high">HIGH THINKING</option>
      <option value="max">MAX THINKING</option>
    </select>
    <select id="statusFilter" class="select-input">
      <option value="all">ALL STATUSES</option>
      <option value="pass">PASSED ONLY</option>
      <option value="fail">FAILED ONLY</option>
    </select>
    <input type="text" id="skillSearch" class="text-input" placeholder="SEARCH SKILLS, MODELS, TAGS..." style="flex:1;min-width:200px"/>
  </section>
  <section class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-title">TOTAL BENCHMARK RUNS</div>
      <div class="kpi-val kpi-accent">${totalRuns.toLocaleString()}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">TOP RANKED SKILL</div>
      <div class="kpi-val">${escapeHtml(topSkill)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">AVERAGE PASS RATE</div>
      <div class="kpi-val kpi-accent">${avgPassRate}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">AVG CACHE HIT RATIO</div>
      <div class="kpi-val">${avgCacheHit}</div>
    </div>
  </section>
  <section class="charts-grid">
    <div class="card">
      <h2 class="card-title">COST ($) VS PASS RATE (%) EFFICIENCY FRONTIER</h2>
      ${scatterSvg}
    </div>
    <div class="card">
      <h2 class="card-title">TOP SKILLS PASS RATE WITH 95% CONFIDENCE INTERVAL</h2>
      ${barSvg}
    </div>
    <div class="card">
      <h2 class="card-title">GENERATION VELOCITY (TOKENS/SEC) BY SKILL</h2>
      ${velocitySvg}
    </div>
    <div class="card">
      <h2 class="card-title">EXECUTION LATENCY PERCENTILES</h2>
      ${latencySvg}
    </div>
  </section>
  <section class="card">
    <h2 class="card-title">LEADERBOARD &amp; PERFORMANCE METRICS</h2>
    <div class="table-wrap">
      <table id="leaderboardTable">
        <thead>
          <tr>
            <th data-col="0" class="sortable">RANK</th>
            <th data-col="1" class="sortable">MODEL</th>
            <th data-col="2" class="sortable">THINKING</th>
            <th data-col="3" class="sortable">SKILL ID</th>
            <th data-col="4" class="sortable">CATEGORY</th>
            <th data-col="5" class="sortable">PASS RATE</th>
            <th data-col="6" class="sortable">SCORE</th>
            <th data-col="7" class="sortable">ELO</th>
            <th data-col="8" class="sortable">DURATION</th>
            <th data-col="9" class="sortable">COST</th>
            <th data-col="10" class="sortable">CACHE HIT</th>
            <th data-col="11" class="sortable">REASONING TOK</th>
            <th data-col="12" class="sortable">RUNS</th>
            <th data-col="13" class="sortable">STAT SIG</th>
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

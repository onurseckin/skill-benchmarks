import {
  renderCostObservations,
  renderLatencyObservations,
  renderTrendObservations,
  renderVelocityObservations,
} from "./dashboard-charts.js";
import type { ReportLeaderboardEntry, ReportSnapshot } from "./report-cohorts.js";

export interface DashboardMetadata {
  readonly title?: string;
}

export function generateHtmlDashboard(snapshot: ReportSnapshot, metadata: DashboardMetadata = {}): string {
  const title = escapeHtml(metadata.title ?? "Benchmark Evidence Dashboard");
  const diagnosticState = snapshot.eligibleRunCount === 0 ? renderUnavailable(snapshot) : "";
  const leaderboard = snapshot.eligibleRunCount === 0 ? "" : renderLeaderboard(snapshot.leaderboard);
  const latency = snapshot.latencyPercentiles === undefined ? "" : renderLatencyObservations(snapshot.latencyPercentiles);
  const trends = snapshot.trends === undefined || snapshot.trends.length === 0 ? "" : renderTrendObservations(snapshot.trends);
  const velocity = snapshot.tokenVelocity === undefined || snapshot.tokenVelocity.length === 0 ? "" : renderVelocityObservations(snapshot.tokenVelocity);
  const costs = snapshot.costEfficiency === undefined || snapshot.costEfficiency.length === 0 ? "" : renderCostObservations(snapshot.costEfficiency);
  const evidenceThrough = snapshot.provenance.evidenceThrough === undefined
    ? "No persisted completion timestamp in this cohort"
    : `Evidence through ${escapeHtml(snapshot.provenance.evidenceThrough)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${dashboardCss()}</style>
</head>
<body>
<main>
<header><h1>${title}</h1><p>Generated ${escapeHtml(snapshot.generatedAt)}</p><p>${evidenceThrough}</p></header>
<section class="facts" aria-label="Report cohort counts">
<article><span>MATCHED</span><strong>${snapshot.matchedRunCount}</strong></article>
<article><span>ELIGIBLE</span><strong>${snapshot.eligibleRunCount}</strong></article>
<article><span>DIAGNOSTIC</span><strong>${snapshot.diagnosticRunCount}</strong></article>
</section>
<section class="panel"><h2>EVIDENCE PROVENANCE</h2><dl><dt>LIVE</dt><dd>${snapshot.provenance.executionModeCounts.live}</dd><dt>FAKE</dt><dd>${snapshot.provenance.executionModeCounts.fake}</dd><dt>SIMULATED</dt><dd>${snapshot.provenance.simulatedRunCount}</dd><dt>NON-SIMULATED</dt><dd>${snapshot.provenance.nonSimulatedRunCount}</dd><dt>EVALUATED</dt><dd>${snapshot.provenance.evaluationStatusCounts.evaluated}</dd><dt>UNEVALUATED</dt><dd>${snapshot.provenance.evaluationStatusCounts.not_evaluated + snapshot.provenance.evaluationStatusCounts.not_requested}</dd></dl></section>
${diagnosticState}${leaderboard}${trends}${costs}${latency}${velocity}
</main>
</body>
</html>`;
}

function renderUnavailable(snapshot: ReportSnapshot): string {
  const simulated = snapshot.provenance.simulatedRunCount > 0 ? "SIMULATED / UNRANKED. " : "";
  return `<section class="unavailable"><h2>NO ELIGIBLE BENCHMARK EVIDENCE</h2><p>${simulated}UNEVALUATED or ineligible records remain available as diagnostic provenance. No ranking, score, pass-rate, trend, or cost claim is available.</p></section>`;
}

function renderLeaderboard(entries: readonly ReportLeaderboardEntry[]): string {
  const rows = entries.map((entry) => `<tr><td>${entry.rank}</td><td>${escapeHtml(entry.category)}</td><td>${escapeHtml(entry.skillId)}</td><td>${escapeHtml(entry.scenarioIds.join(", "))}</td><td>${escapeHtml(entry.modelIds.join(", "))}</td><td>${escapeHtml(entry.providerIds.join(", "))}</td><td>${entry.eligibleRunCount}</td><td>${entry.passCount}</td><td>${entry.failedBenchmarkCount}</td><td>${entry.passRate.toFixed(1)}%</td><td>${entry.score.mean.toFixed(2)}</td><td>${(entry.duration.mean / 1000).toFixed(2)}s</td></tr>`).join("");
  return `<section class="panel"><h2>ELIGIBLE BENCHMARK LEADERBOARD</h2><div class="table-wrap"><table><thead><tr><th>RANK</th><th>CATEGORY</th><th>SKILL</th><th>SCENARIOS</th><th>MODELS</th><th>PROVIDERS</th><th>SAMPLES</th><th>PASSED</th><th>FAILED</th><th>PASS RATE</th><th>MEAN SCORE</th><th>MEAN DURATION</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function dashboardCss(): string {
  return `*{box-sizing:border-box}body{margin:0;background:rgb(0,0,0);color:rgb(255,255,255);font-family:ui-monospace,monospace}main{max-width:1440px;margin:auto;padding:20px;display:grid;gap:18px}header,.panel,.unavailable,article{border:2px solid rgb(255,255,255);padding:18px;box-shadow:4px 4px rgb(255,255,255)}h1,h2,p{margin:0 0 10px}.facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.facts article{display:grid;gap:8px}.facts span,dt{color:rgb(170,170,170);font-size:12px;font-weight:700}.facts strong{font-size:30px}.unavailable{border-color:rgb(255,220,0);box-shadow:4px 4px rgb(255,220,0)}dl{display:grid;grid-template-columns:repeat(6,minmax(80px,1fr));gap:8px;margin:0}dd{margin:0;font-weight:800}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:760px}th,td{text-align:left;padding:9px;border-bottom:1px solid rgb(90,90,90);white-space:nowrap}th{background:rgb(255,255,255);color:rgb(0,0,0)}@media(max-width:640px){main{padding:10px}.facts{grid-template-columns:1fr}dl{grid-template-columns:repeat(2,1fr)}header,.panel,.unavailable,article{box-shadow:2px 2px rgb(255,255,255)}}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

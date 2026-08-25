import type {
  ReportCostPoint,
  ReportLatencyPercentiles,
  ReportTrendPoint,
  ReportVelocityPoint,
} from "./report-cohorts.js";

export function renderCostObservations(points: readonly ReportCostPoint[]): string {
  if (points.length === 0) throw new TypeError("Cost chart requires observed values");
  const rows = points.map((point) => `<tr><td>${escapeHtml(point.skillId)}</td><td>${escapeHtml(point.modelId)}</td><td>${point.sampleCount}</td><td>$${point.averageVerifiedActualCostUSD.toFixed(4)}</td><td>${point.averageScore.toFixed(2)}</td><td>${point.passRate.toFixed(1)}%</td></tr>`).join("");
  return `<section class="panel"><h2>VERIFIED ACTUAL-COST OBSERVATIONS</h2><div class="table-wrap"><table><thead><tr><th>SKILL</th><th>MODEL</th><th>SAMPLES</th><th>MEAN COST</th><th>MEAN SCORE</th><th>PASS RATE</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

export function renderLatencyObservations(value: ReportLatencyPercentiles): string {
  return `<section class="panel"><h2>OBSERVED EXECUTION LATENCY</h2><p>Nearest-rank samples: ${value.sampleCount}</p><dl><dt>P50</dt><dd>${value.p50Ms.toFixed(1)} ms</dd><dt>P90</dt><dd>${value.p90Ms.toFixed(1)} ms</dd><dt>P99</dt><dd>${value.p99Ms.toFixed(1)} ms</dd></dl></section>`;
}

export function renderVelocityObservations(points: readonly ReportVelocityPoint[]): string {
  if (points.length === 0) throw new TypeError("Velocity chart requires observed values");
  const rows = points.map((point) => `<tr><td>${escapeHtml(point.skillId)}</td><td>${escapeHtml(point.modelId)}</td><td>${point.sampleCount}</td><td>${point.meanTokensPerSecond.toFixed(2)}</td></tr>`).join("");
  return `<section class="panel"><h2>OBSERVED MODEL-GENERATION VELOCITY</h2><div class="table-wrap"><table><thead><tr><th>SKILL</th><th>MODEL</th><th>SAMPLES</th><th>MEAN TOKENS PER SECOND</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

export function renderTrendObservations(points: readonly ReportTrendPoint[]): string {
  if (points.length === 0) throw new TypeError("Trend table requires observed values");
  const rows = points.map((point) => `<tr><td>${escapeHtml(point.date)}</td><td>${point.eligibleRunCount}</td><td>${point.passCount}</td><td>${point.passRate.toFixed(1)}%</td><td>${point.score.mean.toFixed(2)}</td><td>${(point.duration.mean / 1000).toFixed(2)}s</td></tr>`).join("");
  return `<section class="panel"><h2>ELIGIBLE EVIDENCE TRENDS</h2><div class="table-wrap"><table><thead><tr><th>DATE</th><th>SAMPLES</th><th>PASSED</th><th>PASS RATE</th><th>MEAN SCORE</th><th>MEAN DURATION</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

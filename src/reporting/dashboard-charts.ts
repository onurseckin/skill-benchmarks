import type { CostEfficiencyPoint, SkillBenchmarkSummary } from "./types.js";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderScatterPlot(
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
      return `<line x1="60" y1="${y}" x2="620" y2="${y}" stroke="#222222" stroke-dasharray="2,2"/><text x="52" y="${y + 4}" text-anchor="end" font-size="10" fill="#888888" font-family="monospace">${pct}%</text>`;
    })
    .join("");

  const gridX = [0, 0.25, 0.5, 0.75, 1.0]
    .map((ratio) => {
      const cost = maxCost * ratio;
      const x = scaleX(cost);
      return `<line x1="${x}" y1="30" x2="${x}" y2="270" stroke="#222222" stroke-dasharray="2,2"/><text x="${x}" y="285" text-anchor="middle" font-size="10" fill="#888888" font-family="monospace">$${cost.toFixed(3)}</text>`;
    })
    .join("");

  const dots = points
    .map((pt) => {
      const cx = scaleX(pt.averageCostUSD).toFixed(1);
      const cy = scaleY(pt.passRate).toFixed(1);
      return `<circle cx="${cx}" cy="${cy}" r="5" fill="#ffffff" stroke="#000000" stroke-width="1.5" class="scatter-point" data-skill="${escapeHtml(pt.skillId)}" data-cost="${pt.averageCostUSD.toFixed(4)}" data-pass="${pt.passRate.toFixed(1)}"/>`;
    })
    .join("");

  const frontierSvg =
    frontierPoints.length > 1
      ? `<polyline points="${frontierPolyline}" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="4,4"/>`
      : "";

  return `<svg viewBox="0 0 650 320" width="100%" height="280" class="chart-svg" style="background:#000000;border:2px solid #ffffff;box-shadow:4px 4px 0px #ffffff"><g>${gridY}${gridX}</g>${frontierSvg}<g>${dots}</g><line x1="60" y1="270" x2="620" y2="270" stroke="#ffffff" stroke-width="2"/><line x1="60" y1="30" x2="60" y2="270" stroke="#ffffff" stroke-width="2"/><text x="340" y="308" text-anchor="middle" font-size="11" fill="#ffffff" font-family="monospace">Average Cost (USD)</text><text x="18" y="150" text-anchor="middle" transform="rotate(-90, 18, 150)" font-size="11" fill="#ffffff" font-family="monospace">Pass Rate (%)</text><g transform="translate(480, 20)"><line x1="0" y1="5" x2="16" y2="5" stroke="#ffffff" stroke-width="2" stroke-dasharray="4,4"/><text x="22" y="8" font-size="10" fill="#ffffff" font-family="monospace">Pareto Frontier</text></g></svg>`;
}

export function renderBarChart(summaries: readonly SkillBenchmarkSummary[]): string {
  const topSummaries = summaries.slice(0, 10);
  const count = Math.max(1, topSummaries.length);
  const step = 560 / count;
  const barWidth = Math.min(36, step * 0.6);

  const gridY = [0, 25, 50, 75, 100]
    .map((pct) => {
      const y = 260 - (pct / 100) * 230;
      return `<line x1="60" y1="${y}" x2="620" y2="${y}" stroke="#222222" stroke-dasharray="2,2"/><text x="52" y="${y + 4}" text-anchor="end" font-size="10" fill="#888888" font-family="monospace">${pct}%</text>`;
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

      return `<g><rect x="${xb.toFixed(1)}" y="${yb.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="0" fill="#ffffff" stroke="#000000" stroke-width="1" class="chart-bar" data-skill="${escapeHtml(s.skillId)}" data-pass="${p.toFixed(1)}" data-ci="[${ciLow.toFixed(1)}%, ${ciHigh.toFixed(1)}%]"/><line x1="${xc.toFixed(1)}" y1="${yHigh.toFixed(1)}" x2="${xc.toFixed(1)}" y2="${yLow.toFixed(1)}" stroke="#ffffff" stroke-width="2"/><line x1="${(xc - 4).toFixed(1)}" y1="${yHigh.toFixed(1)}" x2="${(xc + 4).toFixed(1)}" y2="${yHigh.toFixed(1)}" stroke="#ffffff" stroke-width="2"/><line x1="${(xc - 4).toFixed(1)}" y1="${yLow.toFixed(1)}" x2="${(xc + 4).toFixed(1)}" y2="${yLow.toFixed(1)}" stroke="#ffffff" stroke-width="2"/><text x="${xc.toFixed(1)}" y="${Math.max(18, yHigh - 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="#ffffff" font-family="monospace">${p.toFixed(0)}%</text><text x="${xc.toFixed(1)}" y="276" text-anchor="end" transform="rotate(-35, ${xc.toFixed(1)}, 276)" font-size="10" fill="#aaaaaa" font-family="monospace">${escapeHtml(displayLabel)}</text></g>`;
    })
    .join("");

  return `<svg viewBox="0 0 650 320" width="100%" height="280" class="chart-svg" style="background:#000000;border:2px solid #ffffff;box-shadow:4px 4px 0px #ffffff"><g>${gridY}</g><g>${bars}</g><line x1="60" y1="260" x2="620" y2="260" stroke="#ffffff" stroke-width="2"/><line x1="60" y1="30" x2="60" y2="260" stroke="#ffffff" stroke-width="2"/><text x="18" y="145" text-anchor="middle" transform="rotate(-90, 18, 145)" font-size="11" fill="#ffffff" font-family="monospace">Pass Rate (%)</text><g transform="translate(480, 15)"><line x1="0" y1="5" x2="12" y2="5" stroke="#ffffff" stroke-width="2"/><text x="18" y="8" font-size="10" fill="#ffffff" font-family="monospace">95% Error Bar</text></g></svg>`;
}

export function renderTokenVelocityOverviewChart(velocities: readonly { skillId: string; tokensPerSec: number }[]): string {
  const top = velocities.slice(0, 8);
  const count = Math.max(1, top.length);
  const step = 540 / count;
  const maxVel = Math.max(10, ...top.map((v) => v.tokensPerSec)) * 1.2;

  const bars = top
    .map((v, idx) => {
      const x = 60 + step * idx + 10;
      const w = Math.min(40, step * 0.7);
      const h = (v.tokensPerSec / maxVel) * 200;
      const y = 240 - h;
      return `<g><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#ffffff" stroke="#000000" stroke-width="1"/><text x="${(x + w / 2).toFixed(1)}" y="${Math.max(20, y - 6).toFixed(1)}" text-anchor="middle" font-size="10" fill="#ffffff" font-family="monospace">${v.tokensPerSec.toFixed(0)}</text><text x="${(x + w / 2).toFixed(1)}" y="258" text-anchor="end" transform="rotate(-35, ${(x + w / 2).toFixed(1)}, 258)" font-size="10" fill="#aaaaaa" font-family="monospace">${escapeHtml(v.skillId.slice(0, 10))}</text></g>`;
    })
    .join("");

  return `<svg viewBox="0 0 650 300" width="100%" height="260" class="chart-svg" style="background:#000000;border:2px solid #ffffff;box-shadow:4px 4px 0px #ffffff"><g>${bars}</g><line x1="60" y1="240" x2="620" y2="240" stroke="#ffffff" stroke-width="2"/><line x1="60" y1="20" x2="60" y2="240" stroke="#ffffff" stroke-width="2"/><text x="18" y="130" text-anchor="middle" transform="rotate(-90, 18, 130)" font-size="11" fill="#ffffff" font-family="monospace">Tokens / Sec</text></svg>`;
}

export function renderLatencyPercentilesBarChart(p50: number, p90: number, p99: number): string {
  const maxVal = Math.max(100, p99 * 1.25);
  const items = [
    { label: "P50 (Median)", val: p50 },
    { label: "P90 (Tail)", val: p90 },
    { label: "P99 (Extreme)", val: p99 },
  ];

  const rows = items
    .map((it, idx) => {
      const y = 40 + idx * 50;
      const w = Math.max(10, (it.val / maxVal) * 440);
      return `<text x="120" y="${y + 18}" text-anchor="end" font-size="11" fill="#aaaaaa" font-family="monospace" font-weight="700">${it.label}</text><rect x="130" y="${y}" width="${w.toFixed(1)}" height="26" fill="#ffffff" stroke="#000000" stroke-width="1.5"/><text x="${(140 + w).toFixed(1)}" y="${y + 18}" font-size="11" fill="#ffffff" font-family="monospace" font-weight="900">${it.val.toFixed(0)} ms</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 650 220" width="100%" height="190" class="chart-svg" style="background:#000000;border:2px solid #ffffff;box-shadow:4px 4px 0px #ffffff"><text x="16" y="22" font-size="11" fill="#ffffff" font-family="monospace" font-weight="900">EXECUTION LATENCY PERCENTILES</text><g>${rows}</g></svg>`;
}


import { writeFileSync } from "node:fs";
import type { EligibleRunRecord } from "./types.js";

export interface BadgeOptions {
  readonly label: string;
  readonly value: string | number;
  readonly color?: string;
  readonly style?: "flat" | "neo";
}

export interface ReportCardOptions {
  readonly title?: string;
  readonly includeChecks?: boolean;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function generateBenchmarkBadgeSvg(options: BadgeOptions): string {
  const label = escapeXml(options.label.toUpperCase());
  const value = escapeXml(String(options.value));
  const style = options.style ?? "neo";
  const labelWidth = Math.max(50, label.length * 8 + 16);
  const valueWidth = Math.max(50, value.length * 8 + 16);
  const totalWidth = labelWidth + valueWidth;
  const height = 28;

  if (style === "neo") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth + 4}" height="${height + 4}" viewBox="0 0 ${totalWidth + 4} ${height + 4}"><rect x="4" y="4" width="${totalWidth}" height="${height}" fill="#ffffff"/><rect x="0" y="0" width="${totalWidth}" height="${height}" fill="#000000" stroke="#ffffff" stroke-width="2"/><rect x="0" y="0" width="${labelWidth}" height="${height}" fill="#111111" stroke="#ffffff" stroke-width="2"/><text x="${labelWidth / 2}" y="18" fill="#888888" font-family="monospace" font-size="11" font-weight="900" text-anchor="middle">${label}</text><text x="${labelWidth + valueWidth / 2}" y="18" fill="#ffffff" font-family="monospace" font-size="11" font-weight="900" text-anchor="middle">${value}</text></svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" viewBox="0 0 ${totalWidth} 20"><rect width="${labelWidth}" height="20" fill="#555555"/><rect x="${labelWidth}" width="${valueWidth}" height="20" fill="#222222"/><text x="${labelWidth / 2}" y="14" fill="#ffffff" font-family="sans-serif" font-size="10" font-weight="700" text-anchor="middle">${label}</text><text x="${labelWidth + valueWidth / 2}" y="14" fill="#ffffff" font-family="sans-serif" font-size="10" font-weight="700" text-anchor="middle">${value}</text></svg>`;
}

export function generateReportCardHtml(
  item: EligibleRunRecord,
  options: ReportCardOptions = {}
): string {
  const title = escapeXml(options.title ?? `Benchmark Run: ${item.runId}`);
  const score = item.compositeScore.toFixed(3);
  const passRate = item.passedBenchmark ? "100.0%" : "0.0%";
  const cost = item.actualCostUSD === undefined ? "UNVERIFIED" : `$${item.actualCostUSD.toFixed(4)}`;
  const duration = `${(item.wallClockMs / 1000).toFixed(2)}s`;
  const badgeSvg = generateBenchmarkBadgeSvg({ label: "SKILL-BENCHMARK", value: `${score} (${passRate})` });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
  <style>
    body { background: #000000; color: #ffffff; font-family: "JetBrains Mono", monospace; padding: 24px; margin: 0; }
    .card-container { max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
    .header-box { border: 2px solid #ffffff; box-shadow: 4px 4px 0px #ffffff; padding: 20px; background: #000000; display: flex; justify-content: space-between; align-items: center; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .kpi-cell { border: 2px solid #ffffff; box-shadow: 2px 2px 0px #ffffff; padding: 14px; background: #000000; }
    .kpi-label { font-size: 10px; color: #888888; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; }
    .kpi-val { font-size: 22px; font-weight: 900; color: #ffffff; }
  </style>
</head>
<body>
  <main class="card-container">
    <header class="header-box">
      <div>
        <h1 style="font-size:18px;font-weight:900;margin:0 0 6px;text-transform:uppercase">⚡ ${title}</h1>
        <div style="font-size:11px;color:#888888">Scenario: ${escapeXml(item.scenarioId)} &bull; Skill: ${escapeXml(item.skillId)} &bull; Model: ${escapeXml(item.modelId)}</div>
      </div>
      <div>${badgeSvg}</div>
    </header>
    <section class="kpi-grid">
      <div class="kpi-cell"><div class="kpi-label">SCORE</div><div class="kpi-val">${score}</div></div>
      <div class="kpi-cell"><div class="kpi-label">PASS RATE</div><div class="kpi-val">${passRate}</div></div>
      <div class="kpi-cell"><div class="kpi-label">DURATION</div><div class="kpi-val">${duration}</div></div>
      <div class="kpi-cell"><div class="kpi-label">COST (USD)</div><div class="kpi-val">${cost}</div></div>
    </section>
  </main>
</body>
</html>`;
}

export function exportReportCard(
  item: EligibleRunRecord,
  format: "svg" | "html",
  outputPath: string
): void {
  if (format === "svg") {
    const score = item.compositeScore.toFixed(3);
    const svg = generateBenchmarkBadgeSvg({
      label: item.skillId,
      value: score,
    });
    writeFileSync(outputPath, svg, "utf8");
  } else {
    const html = generateReportCardHtml(item);
    writeFileSync(outputPath, html, "utf8");
  }
}

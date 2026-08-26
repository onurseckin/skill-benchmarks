import type { ReportLeaderboardEntry } from "./report-cohorts.js";

export interface ReportCardOptions {
  readonly title?: string;
}

export function generateReportCardHtml(
  entry: ReportLeaderboardEntry,
  options: ReportCardOptions = {},
): string {
  requireCardEntry(entry);
  const title = escapeXml(options.title ?? `Eligible benchmark: ${entry.skillId}`);
  const cost =
    entry.verifiedActualCost === undefined
      ? "VERIFIED ACTUAL COST UNAVAILABLE"
      : `$${entry.verifiedActualCost.mean.toFixed(4)} (${entry.verifiedActualCost.sampleCount} samples)`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{background:rgb(0,0,0);color:rgb(255,255,255);font-family:ui-monospace,monospace;padding:24px}.card{max-width:760px;margin:auto;border:2px solid rgb(255,255,255);box-shadow:4px 4px rgb(255,255,255);padding:20px}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.fact{border:1px solid rgb(255,255,255);padding:12px}.label{color:rgb(170,170,170);font-size:11px}.value{font-size:20px;font-weight:800}</style></head><body><main class="card"><h1>${title}</h1><p>${escapeXml(entry.category)} · ${escapeXml(entry.skillId)}</p><div class="facts"><div class="fact"><div class="label">ELIGIBLE SAMPLES</div><div class="value">${entry.eligibleRunCount}</div></div><div class="fact"><div class="label">PASS RATE</div><div class="value">${entry.passRate.toFixed(1)}%</div></div><div class="fact"><div class="label">MEAN SCORE</div><div class="value">${entry.score.mean.toFixed(2)}</div></div><div class="fact"><div class="label">VERIFIED ACTUAL COST</div><div class="value">${cost}</div></div></div></main></body></html>`;
}

export function generateReportCardSvg(entry: ReportLeaderboardEntry): string {
  requireCardEntry(entry);
  const skill = escapeXml(entry.skillId);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160" viewBox="0 0 640 160"><rect width="640" height="160" fill="rgb(0,0,0)" stroke="rgb(255,255,255)" stroke-width="4"/><text x="24" y="42" fill="rgb(255,255,255)" font-family="monospace" font-size="22" font-weight="700">${skill}</text><text x="24" y="78" fill="rgb(170,170,170)" font-family="monospace" font-size="16">ELIGIBLE SAMPLES ${entry.eligibleRunCount}</text><text x="24" y="112" fill="rgb(255,255,255)" font-family="monospace" font-size="20">PASS ${entry.passRate.toFixed(1)}% · SCORE ${entry.score.mean.toFixed(2)}</text></svg>`;
}

export function renderReportCard(entry: ReportLeaderboardEntry, format: "svg" | "html"): string {
  return format === "svg" ? generateReportCardSvg(entry) : generateReportCardHtml(entry);
}

function requireCardEntry(entry: ReportLeaderboardEntry): void {
  if (
    !Number.isSafeInteger(entry.eligibleRunCount) ||
    entry.eligibleRunCount < 1 ||
    entry.score.sampleCount < 1
  ) {
    throw new TypeError("Report card requires eligible benchmark evidence");
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

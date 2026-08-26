import { escapeHtmlText } from "../shared/html-escape.js";
import type {
  ReportCostPoint,
  ReportLatencyPercentiles,
  ReportTrendPoint,
  ReportVelocityPoint,
} from "./report-cohorts.js";

const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 6,
});

export function renderCostObservations(points: readonly ReportCostPoint[]): string {
  if (points.length === 0) throw new TypeError("Cost chart requires observed values");
  const visible = points.slice(0, 20);
  const bars = renderBars(
    visible.map((point) => ({
      label: `${point.skillId} · ${point.modelId}`,
      value: point.averageVerifiedActualCostUSD,
    })),
    "cost-chart-title",
    "cost-chart-description",
    "Verified actual mean cost",
    currency,
  );
  const rows = points
    .map(
      (point) =>
        `<tr><th scope="row">${escapeHtmlText(point.skillId)}</th><td>${escapeHtmlText(point.modelId)}</td><td>${decimal.format(point.sampleCount)}</td><td>${currency.format(point.averageVerifiedActualCostUSD)}</td><td>${decimal.format(point.averageScore)}</td><td>${percent.format(point.passRate / 100)}</td></tr>`,
    )
    .join("");
  return `<section class="panel" aria-labelledby="cost-heading"><h2 id="cost-heading">VERIFIED ACTUAL-COST OBSERVATIONS</h2><div class="chart-layout"><figure>${bars}<figcaption>Mean verified actual cost for ${decimal.format(visible.length)} of ${decimal.format(points.length)} eligible cohorts; the table retains every cohort.</figcaption></figure><div class="table-wrap"><table><caption>Verified actual-cost evidence with explicit sample counts</caption><thead><tr><th scope="col">SKILL</th><th scope="col">MODEL</th><th scope="col">SAMPLES</th><th scope="col">MEAN COST</th><th scope="col">MEAN SCORE</th><th scope="col">PASS RATE</th></tr></thead><tbody>${rows}</tbody></table></div></div></section>`;
}

export function renderLatencyObservations(value: ReportLatencyPercentiles): string {
  return `<section class="panel" aria-labelledby="latency-heading"><h2 id="latency-heading">OBSERVED EXECUTION LATENCY</h2><p>Nearest-rank method across ${decimal.format(value.sampleCount)} eligible samples.</p><dl><dt>P50</dt><dd>${decimal.format(value.p50Ms)} ms</dd><dt>P90</dt><dd>${decimal.format(value.p90Ms)} ms</dd><dt>P99</dt><dd>${decimal.format(value.p99Ms)} ms</dd></dl></section>`;
}

export function renderVelocityObservations(points: readonly ReportVelocityPoint[]): string {
  if (points.length === 0) throw new TypeError("Velocity chart requires observed values");
  const rows = points
    .map(
      (point) =>
        `<tr><th scope="row">${escapeHtmlText(point.skillId)}</th><td>${escapeHtmlText(point.modelId)}</td><td>${decimal.format(point.sampleCount)}</td><td>${decimal.format(point.meanTokensPerSecond)}</td></tr>`,
    )
    .join("");
  return `<section class="panel" aria-labelledby="velocity-heading"><h2 id="velocity-heading">OBSERVED MODEL-GENERATION VELOCITY</h2><div class="table-wrap"><table><caption>Observed generation velocity with explicit eligible sample counts</caption><thead><tr><th scope="col">SKILL</th><th scope="col">MODEL</th><th scope="col">SAMPLES</th><th scope="col">MEAN TOKENS PER SECOND</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

export function renderTrendObservations(points: readonly ReportTrendPoint[]): string {
  if (points.length === 0) throw new TypeError("Trend chart requires observed values");
  const visible = points.slice(-20);
  const line = renderTrendLine(visible);
  const rows = points
    .map(
      (point) =>
        `<tr><th scope="row"><time datetime="${escapeHtmlText(point.date)}">${escapeHtmlText(point.date)}</time></th><td>${decimal.format(point.eligibleRunCount)}</td><td>${decimal.format(point.passCount)}</td><td>${percent.format(point.passRate / 100)}</td><td>${decimal.format(point.score.mean)}</td><td>${decimal.format(point.duration.mean / 1000)} s</td></tr>`,
    )
    .join("");
  return `<section class="panel" aria-labelledby="trend-heading"><h2 id="trend-heading">ELIGIBLE EVIDENCE TRENDS</h2><div class="chart-layout"><figure>${line}<figcaption>Observed mean score for the latest ${decimal.format(visible.length)} of ${decimal.format(points.length)} dated eligible cohorts; the table retains every cohort.</figcaption></figure><div class="table-wrap"><table><caption>Eligible trend evidence with explicit sample counts</caption><thead><tr><th scope="col">DATE</th><th scope="col">SAMPLES</th><th scope="col">PASSED</th><th scope="col">PASS RATE</th><th scope="col">MEAN SCORE</th><th scope="col">MEAN DURATION</th></tr></thead><tbody>${rows}</tbody></table></div></div></section>`;
}

function renderTrendLine(points: readonly ReportTrendPoint[]): string {
  const width = 640;
  const height = 260;
  const values = points.map((point) => point.score.mean);
  const maximum = Math.max(...values, 1);
  const minimum = Math.min(...values, 0);
  const range = Math.max(maximum - minimum, 1);
  const positions = values
    .map((value, index) => {
      const x = points.length === 1 ? width / 2 : 44 + index * ((width - 72) / (points.length - 1));
      const y = height - 36 - ((value - minimum) / range) * (height - 72);
      return `${decimal.format(x)},${decimal.format(y)}`;
    })
    .join(" ");
  const firstDate = escapeHtmlText(points[0]?.date ?? "");
  const lastDate = escapeHtmlText(points.at(-1)?.date ?? "");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="trend-chart-title trend-chart-description"><title id="trend-chart-title">Eligible mean score over time</title><desc id="trend-chart-description">A line connecting observed mean scores from ${firstDate} through ${lastDate}.</desc><line class="axis" x1="44" y1="${height - 36}" x2="${width - 28}" y2="${height - 36}"></line><line class="axis" x1="44" y1="36" x2="44" y2="${height - 36}"></line><polyline class="mark" points="${positions}"></polyline><text x="44" y="${height - 12}">${firstDate}</text><text x="${width - 160}" y="${height - 12}">${lastDate}</text><text x="8" y="40">${decimal.format(maximum)}</text><text x="8" y="${height - 40}">${decimal.format(minimum)}</text></svg>`;
}

interface BarDatum {
  readonly label: string;
  readonly value: number;
}

function renderBars(
  values: readonly BarDatum[],
  titleId: string,
  descriptionId: string,
  title: string,
  formatter: Intl.NumberFormat,
): string {
  const width = 640;
  const rowHeight = 34;
  const height = Math.max(160, values.length * rowHeight + 56);
  const maximum = Math.max(...values.map((entry) => entry.value), 1);
  const bars = values
    .map((entry, index) => {
      const y = 26 + index * rowHeight;
      const barWidth = (entry.value / maximum) * 300;
      return `<text x="8" y="${y + 16}">${escapeHtmlText(shorten(entry.label))}</text><rect class="bar" x="280" y="${y}" width="${decimal.format(barWidth)}" height="20"></rect><text x="${decimal.format(290 + barWidth)}" y="${y + 16}">${escapeHtmlText(formatter.format(entry.value))}</text>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId} ${descriptionId}"><title id="${titleId}">${escapeHtmlText(title)}</title><desc id="${descriptionId}">Horizontal bars show the exact observed value for each displayed eligible cohort.</desc>${bars}</svg>`;
}

function shorten(value: string): string {
  return value.length <= 34 ? value : `${value.slice(0, 31)}…`;
}

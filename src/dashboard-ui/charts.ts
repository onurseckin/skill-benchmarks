import type {
  ChartPoint,
  ChartSeries,
  LatencyPercentiles,
  TelemetryChartData,
  ThemeTokens,
  TokenVelocityPoint,
} from "./types.js";
import { escapeHtml } from "./components.js";

export function renderTokenVelocityChartSvg(
  points: readonly TokenVelocityPoint[],
  theme: ThemeTokens,
  width = 600,
  height = 200
): string {
  const padLeft = 50;
  const padRight = 20;
  const padTop = 24;
  const padBottom = 30;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const maxTokensPerSec = Math.max(50, ...points.map((p) => p.tokensPerSec)) * 1.15;
  const maxTurn = Math.max(1, ...points.map((p) => p.turn));

  const scaleX = (turn: number): number => padLeft + (turn / maxTurn) * chartW;
  const scaleY = (val: number): number => padTop + chartH - (val / maxTokensPerSec) * chartH;

  const gridY = [0, 0.25, 0.5, 0.75, 1.0]
    .map((ratio) => {
      const val = maxTokensPerSec * ratio;
      const y = scaleY(val);
      return `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="#222222" stroke-dasharray="2,2"/><text x="${padLeft - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#888888" font-family="${theme.fontMono}" font-weight="700">${val.toFixed(0)} t/s</text>`;
    })
    .join("");

  const polylinePts = points
    .map((p) => `${scaleX(p.turn).toFixed(1)},${scaleY(p.tokensPerSec).toFixed(1)}`)
    .join(" ");

  const circles = points
    .map((p) => {
      const cx = scaleX(p.turn).toFixed(1);
      const cy = scaleY(p.tokensPerSec).toFixed(1);
      return `<circle cx="${cx}" cy="${cy}" r="4" fill="#ffffff" stroke="#000000" stroke-width="1.5"/>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="background:#000000;border:2px solid #ffffff;box-shadow:4px 4px 0px #ffffff"><g>${gridY}</g><polyline points="${polylinePts}" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="miter"/><g>${circles}</g><line x1="${padLeft}" y1="${padTop + chartH}" x2="${width - padRight}" y2="${padTop + chartH}" stroke="#ffffff" stroke-width="2"/><line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + chartH}" stroke="#ffffff" stroke-width="2"/><text x="${width / 2}" y="${height - 6}" text-anchor="middle" font-size="10" fill="#888888" font-weight="700" font-family="${theme.fontMono}">EXECUTION TURNS</text><text x="${padLeft + 10}" y="16" font-size="10" fill="#ffffff" font-weight="900" font-family="${theme.fontMono}">TOKEN VELOCITY (TOKENS/SEC)</text></svg>`;
}

export function renderLatencyPercentilesSvg(
  percentiles: LatencyPercentiles,
  theme: ThemeTokens,
  width = 600,
  height = 180
): string {
  const padLeft = 80;
  const padRight = 30;
  const padTop = 30;
  const maxVal = Math.max(100, percentiles.max || percentiles.p99 * 1.25);
  const barHeight = 22;
  const chartW = width - padLeft - padRight;

  const items = [
    { label: "P50 (MEDIAN)", val: percentiles.p50, color: "#ffffff" },
    { label: "P90 (TAIL)", val: percentiles.p90, color: "#cccccc" },
    { label: "P99 (EXTREME)", val: percentiles.p99, color: "#ffffff" },
  ];

  const bars = items
    .map((item, idx) => {
      const y = padTop + idx * 42;
      const w = Math.max(4, (item.val / maxVal) * chartW);
      return `<text x="${padLeft - 10}" y="${y + 15}" text-anchor="end" font-size="10" fill="#aaaaaa" font-weight="800" font-family="${theme.fontMono}">${item.label}</text><rect x="${padLeft}" y="${y}" width="${w.toFixed(1)}" height="${barHeight}" fill="${item.color}" stroke="#ffffff" stroke-width="1.5"/><text x="${(padLeft + w + 8).toFixed(1)}" y="${y + 15}" font-size="10" fill="#ffffff" font-weight="900" font-family="${theme.fontMono}">${item.val.toFixed(0)} ms</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="background:#000000;border:2px solid #ffffff;box-shadow:4px 4px 0px #ffffff"><text x="16" y="18" font-size="10" fill="#ffffff" font-weight="900" font-family="${theme.fontMono}">LATENCY DISTRIBUTION PERCENTILES</text><g>${bars}</g></svg>`;
}

export function renderMultiSeriesTelemetryChartSvg(
  data: TelemetryChartData,
  theme: ThemeTokens,
  options: { width?: number; height?: number } = {}
): string {
  const width = options.width ?? data.width ?? 600;
  const height = options.height ?? data.height ?? 180;
  const padLeft = 46;
  const padRight = 20;
  const padTop = 28;
  const padBottom = 32;

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
      return `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="#222222" stroke-dasharray="2,2"/><text x="${padLeft - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#888888" font-weight="700" font-family="${theme.fontMono}">${val.toFixed(0)}</text>`;
    })
    .join("");

  const polylines = series
    .map((s, idx) => {
      const stroke = idx === 0 ? "#ffffff" : "#aaaaaa";
      const dash = idx === 1 ? ' stroke-dasharray="3,3"' : "";
      const pts = s.points.map((p) => `${scaleX(p.x).toFixed(1)},${scaleY(p.y).toFixed(1)}`).join(" ");
      return `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="2"${dash} stroke-linejoin="miter"/>`;
    })
    .join("");

  const legends = series
    .map((s, idx) => {
      const x = padLeft + idx * 160;
      const stroke = idx === 0 ? "#ffffff" : "#aaaaaa";
      return `<g transform="translate(${x}, 14)"><line x1="0" y1="4" x2="16" y2="4" stroke="${stroke}" stroke-width="2.5"/><text x="22" y="7" font-size="10" fill="#ffffff" font-weight="800" font-family="${theme.fontMono}">${escapeHtml(s.name.toUpperCase())}</text></g>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="background:#000000;border:2px solid #ffffff;box-shadow:4px 4px 0px #ffffff"><g>${gridY}</g>${polylines}<line x1="${padLeft}" y1="${padTop + chartH}" x2="${width - padRight}" y2="${padTop + chartH}" stroke="#ffffff" stroke-width="2"/><line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + chartH}" stroke="#ffffff" stroke-width="2"/><g>${legends}</g></svg>`;
}

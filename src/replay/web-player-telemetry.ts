import type { CgroupTelemetryPoint } from "./types.js";

const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, useGrouping: false });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function renderWebTelemetry(points: readonly CgroupTelemetryPoint[]): string {
  if (points.length === 0) return "";
  const displayed = boundedSamples(points);
  const width = 640;
  const height = 240;
  const peakCpu = Math.max(...points.map((point) => point.cpuPercent));
  const peakMemory = Math.max(...points.map((point) => point.memoryRssMb));
  const cpuMaximum = Math.max(100, peakCpu, 1);
  const memoryMaximum = Math.max(...points.map((point) => point.memoryLimitMb), peakMemory, 1);
  const step = displayed.length > 1 ? (width - 72) / (displayed.length - 1) : 0;
  const cpu = displayed.map((point, index) => coordinate(index, point.cpuPercent, cpuMaximum, step, height)).join(" ");
  const memory = displayed.map((point, index) => coordinate(index, point.memoryRssMb, memoryMaximum, step, height)).join(" ");
  return `<section class="card" aria-labelledby="telemetry-heading"><h2 id="telemetry-heading">Recorded resource telemetry</h2><div class="telemetry-layout"><figure><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="telemetry-chart-title telemetry-chart-description"><title id="telemetry-chart-title">CPU and memory samples over persisted replay time</title><desc id="telemetry-chart-description">Two lines connect ${integer.format(displayed.length)} bounded points selected from ${integer.format(points.length)} recorded resource samples. CPU peaks at ${decimal.format(peakCpu)} percent and memory peaks at ${decimal.format(peakMemory)} megabytes.</desc><line class="axis" x1="44" y1="${height - 32}" x2="${width - 28}" y2="${height - 32}"></line><line class="axis" x1="44" y1="28" x2="44" y2="${height - 32}"></line><polyline class="cpu" points="${cpu}"></polyline><polyline class="memory" points="${memory}"></polyline><text x="48" y="24">CPU</text><text x="118" y="24">Memory</text><text x="44" y="${height - 10}">First sample</text><text x="${width - 122}" y="${height - 10}">Last sample</text></svg><figcaption>Observed CPU and memory values from the persisted event stream.</figcaption></figure><dl><div><dt>Recorded samples</dt><dd>${integer.format(points.length)}</dd></div><div><dt>Displayed samples</dt><dd>${integer.format(displayed.length)}</dd></div><div><dt>Peak CPU</dt><dd>${decimal.format(peakCpu)}%</dd></div><div><dt>Peak memory RSS</dt><dd>${decimal.format(peakMemory)} MB</dd></div></dl></div></section>`;
}

function boundedSamples(points: readonly CgroupTelemetryPoint[]): readonly CgroupTelemetryPoint[] {
  if (points.length <= 50) return points;
  return Array.from({ length: 50 }, (_, index) => points[Math.round(index * (points.length - 1) / 49)] as CgroupTelemetryPoint);
}

function coordinate(index: number, value: number, maximum: number, step: number, height: number): string {
  const x = 44 + index * step;
  const y = height - 32 - (value / maximum) * (height - 60);
  return `${decimal.format(x)},${decimal.format(y)}`;
}

const SPARKLINE_CHARS = [" ", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

export interface AsciiDataPoint {
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

export function renderAsciiSparkline(numbers: readonly number[]): string {
  if (numbers.length === 0) return "";
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const range = max - min || 1;

  return numbers
    .map((n) => {
      const idx = Math.min(
        SPARKLINE_CHARS.length - 1,
        Math.max(0, Math.floor(((n - min) / range) * (SPARKLINE_CHARS.length - 1)))
      );
      return SPARKLINE_CHARS[idx];
    })
    .join("");
}

export function renderAsciiBarChart(
  items: readonly { label: string; value: number; max?: number }[],
  maxWidth = 30
): string {
  const maxVal = Math.max(1, ...items.map((i) => i.max ?? i.value));
  return items
    .map((item) => {
      const ratio = Math.min(1, Math.max(0, item.value / maxVal));
      const filled = Math.round(ratio * maxWidth);
      const bar = "█".repeat(filled).padEnd(maxWidth, "░");
      const label = item.label.padEnd(16, " ").slice(0, 16);
      return `${label} [${bar}] ${item.value.toFixed(1)}`;
    })
    .join("\n");
}

export function renderAsciiParetoChart(
  points: readonly AsciiDataPoint[],
  width = 50,
  height = 12
): string {
  if (points.length === 0) return "  No data points for Pareto frontier.";

  const maxX = Math.max(0.01, ...points.map((p) => p.x));
  const maxY = Math.max(1, ...points.map((p) => p.y));

  const grid: string[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => " ")
  );

  for (const pt of points) {
    const gx = Math.min(width - 1, Math.max(0, Math.round((pt.x / maxX) * (width - 1))));
    const gy = Math.min(height - 1, Math.max(0, Math.round(((maxY - pt.y) / maxY) * (height - 1))));
    grid[gy]![gx] = "*";
  }

  const lines: string[] = [];
  lines.push(`  Pass % (Max: ${maxY.toFixed(0)}%)`);
  lines.push("  ┌" + "─".repeat(width) + "┐");
  for (let r = 0; r < height; r++) {
    lines.push(`  │${grid[r]!.join("")}│`);
  }
  lines.push("  └" + "─".repeat(width) + "┘");
  lines.push(`  0${" ".repeat(width - 8)}Cost: $${maxX.toFixed(3)}`);
  return lines.join("\n");
}

export function renderAsciiLatencyDistribution(
  p50: number,
  p90: number,
  p99: number,
  maxWidth = 30
): string {
  const maxVal = Math.max(100, p99 * 1.2);
  const scale = (v: number): string => {
    const len = Math.max(1, Math.round((v / maxVal) * maxWidth));
    return "█".repeat(len).padEnd(maxWidth, " ");
  };

  return [
    `  P50 (Median) : [${scale(p50)}] ${p50.toFixed(0)} ms`,
    `  P90 (Tail)   : [${scale(p90)}] ${p90.toFixed(0)} ms`,
    `  P99 (Extreme): [${scale(p99)}] ${p99.toFixed(0)} ms`,
  ].join("\n");
}

import {
  renderAsciiBarChart,
  renderAsciiLatencyDistribution,
  renderAsciiParetoChart,
  renderAsciiSparkline,
} from "./ascii-charts.js";

export interface ReplHudState {
  readonly currentTrial: string;
  readonly scenarioId: string;
  readonly skillId: string;
  readonly modelId: string;
  readonly turnIndex: number;
  readonly maxTurns: number;
  readonly elapsedMs: number;
  readonly passCount: number;
  readonly failCount: number;
  readonly totalSpendUSD: number;
  readonly eventThroughputFps: number;
  readonly tokenVelocitySparkline?: readonly number[];
  readonly latencyPercentiles?: {
    readonly p50: number;
    readonly p90: number;
    readonly p99: number;
  };
}

export function renderReplHud(state: ReplHudState): string {
  const total = state.passCount + state.failCount;
  const passRate = total > 0 ? ((state.passCount / total) * 100).toFixed(1) : "0.0";
  const elapsedSec = (state.elapsedMs / 1000).toFixed(2);
  const sparkline = state.tokenVelocitySparkline
    ? renderAsciiSparkline(state.tokenVelocitySparkline)
    : "——";

  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════════════════════════════════════════════╗");
  lines.push(`║ ⚡ SKILL-BENCHMARKS REPL HUD & LIVE EXECUTION MONITOR                         ║`);
  lines.push("╠══════════════════════════════════════════════════════════════════════════════╣");
  lines.push(`║ Trial:   ${state.currentTrial.padEnd(64, " ").slice(0, 64)} ║`);
  lines.push(
    `║ Target:  [${state.scenarioId}] -> [${state.skillId}] -> [${state.modelId}]`.padEnd(79, " ") +
      "║",
  );
  lines.push(
    `║ Turn:    ${state.turnIndex}/${state.maxTurns}  |  Time: ${elapsedSec}s  |  Throughput: ${state.eventThroughputFps.toFixed(1)} evt/s`.padEnd(
      79,
      " ",
    ) + "║",
  );
  lines.push(
    `║ Results: ${state.passCount} PASS / ${state.failCount} FAIL (${passRate}%)  |  Spend: $${state.totalSpendUSD.toFixed(4)}`.padEnd(
      79,
      " ",
    ) + "║",
  );
  lines.push(`║ Spark:   Velocity Trend: [${sparkline}]`.padEnd(79, " ") + "║");

  if (state.latencyPercentiles) {
    lines.push("╟──────────────────────────────────────────────────────────────────────────────╢");
    lines.push("║ Latency Breakdown (ms):                                                      ║");
    const latStr = renderAsciiLatencyDistribution(
      state.latencyPercentiles.p50,
      state.latencyPercentiles.p90,
      state.latencyPercentiles.p99,
      25,
    );
    for (const l of latStr.split("\n")) {
      lines.push(`║ ${l.padEnd(76, " ")} ║`);
    }
  }

  lines.push("╟──────────────────────────────────────────────────────────────────────────────╢");
  lines.push(
    "║ Controls: [Space] Pause/Play  [1-5] Views  [v] Verbose  [c] Export Card  [q] Quit ║",
  );
  lines.push("╚══════════════════════════════════════════════════════════════════════════════╝");

  return lines.join("\n");
}

export function renderInteractiveParetoSummary(
  items: readonly { skillId: string; passRate: number; cost: number }[],
): string {
  const points = items.map((i) => ({ label: i.skillId, x: i.cost, y: i.passRate }));
  return renderAsciiParetoChart(points, 48, 8);
}

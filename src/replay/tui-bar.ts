import { dim } from "../cli/formatter.js";

export function renderReplayBar(
  value: number,
  max: number,
  width: number,
  color: (value: string) => string,
): string {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  const filledCount = Math.round(ratio * width);
  const emptyCount = Math.max(0, width - filledCount);
  const filled = color("━".repeat(filledCount));
  const empty = dim("─".repeat(emptyCount));
  return `[${filled}${empty}] ${(ratio * 100).toFixed(0)}%`;
}

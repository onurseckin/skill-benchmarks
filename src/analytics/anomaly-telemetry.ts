import type { AnomalySeverity, TrajectoryStep, TrajectoryTelemetryMetrics } from "./types.js";

export function stableTrajectoryValue(value: unknown): string {
  if (value === null || typeof value !== "object") return String(value);
  if (Array.isArray(value)) return "[" + value.map(stableTrajectoryValue).join(",") + "]";
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    "{" +
    keys.map((key) => JSON.stringify(key) + ":" + stableTrajectoryValue(record[key])).join(",") +
    "}"
  );
}

export function calculateAnomalySeverityScore(severity: AnomalySeverity): number {
  switch (severity) {
    case "critical":
      return 10;
    case "high":
      return 7;
    case "medium":
      return 4;
    case "low":
      return 2;
    case "info":
      return 1;
  }
}

export function calculateTrajectoryTelemetry(
  steps: readonly TrajectoryStep[],
  totalTokens: number,
  totalDurationMs: number,
): TrajectoryTelemetryMetrics {
  const totalSteps = steps.length;
  let toolCallCount = 0;
  let errorCount = 0;
  let duplicateToolCallCount = 0;
  let totalLatency = 0;
  const seenCalls = new Set<string>();

  for (const step of steps) {
    totalLatency += step.latencyMs;
    if (step.type === "action" || step.toolName) {
      toolCallCount++;
      const callKey = (step.toolName ?? "") + ":" + stableTrajectoryValue(step.toolInput ?? {});
      if (seenCalls.has(callKey)) duplicateToolCallCount++;
      else seenCalls.add(callKey);
    }

    if (
      step.type === "error" ||
      (step.exitCode !== undefined && step.exitCode !== 0) ||
      Boolean(step.error)
    ) {
      errorCount++;
    }
  }

  const tokenConsumptionRatePerStep = totalSteps > 0 ? Math.round(totalTokens / totalSteps) : 0;
  const retryRatio =
    toolCallCount > 0 ? Number((duplicateToolCallCount / toolCallCount).toFixed(4)) : 0;
  const oscillationScore =
    totalSteps > 0 ? Number((duplicateToolCallCount / totalSteps).toFixed(4)) : 0;
  const averageLatencyMs = totalSteps > 0 ? Math.round(totalLatency / totalSteps) : 0;

  return {
    totalSteps,
    totalTokens,
    totalDurationMs,
    toolCallCount,
    errorCount,
    duplicateToolCallCount,
    tokenConsumptionRatePerStep,
    retryRatio,
    oscillationScore,
    averageLatencyMs,
  };
}

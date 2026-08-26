import { randomUUID } from "node:crypto";
import { createSafeArtifactPathSegment } from "../shared/artifact-sanitization.js";
import type { SweepEvent, SweepEventListener, SweepProgress } from "./types.js";

export function createInitialSweepIdentity(sweepId?: string): {
  readonly constructorSweepId?: string;
  readonly sweepId: string;
} {
  const constructorSweepId =
    sweepId === undefined ? undefined : createSafeArtifactPathSegment(sweepId, "sweep");
  return {
    ...(constructorSweepId === undefined ? {} : { constructorSweepId }),
    sweepId:
      constructorSweepId ??
      createSafeArtifactPathSegment(`sweep-${Date.now()}-${randomUUID()}`, "sweep"),
  };
}

export interface SweepProgressInput {
  readonly sweepId: string;
  readonly totalCells: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly abortedCount: number;
  readonly skippedCount: number;
  readonly inFlightCount: number;
  readonly totalTokensConsumed: number;
  readonly totalCostUSD: number;
  readonly totalCellDurationMs: number;
  readonly startTimeMs: number;
}

export function createSweepProgress(input: SweepProgressInput): SweepProgress {
  const elapsedMs = input.startTimeMs > 0 ? Date.now() - input.startTimeMs : 0;
  const finished =
    input.completedCount + input.failedCount + input.abortedCount + input.skippedCount;
  const percentage = input.totalCells > 0 ? (finished / input.totalCells) * 100 : 0;
  const averageDuration = finished > 0 ? input.totalCellDurationMs / finished : 0;
  const remaining = Math.max(0, input.totalCells - finished);
  return {
    sweepId: input.sweepId,
    totalCells: input.totalCells,
    completedCells: input.completedCount,
    failedCells: input.failedCount,
    abortedCells: input.abortedCount,
    skippedCells: input.skippedCount,
    inFlightCells: input.inFlightCount,
    queuedCells: Math.max(0, input.totalCells - finished - input.inFlightCount),
    percentage: Number(percentage.toFixed(2)),
    elapsedMs,
    estimatedRemainingMs: Math.round(remaining * (averageDuration > 0 ? averageDuration : 5000)),
    totalTokensConsumed: input.totalTokensConsumed,
    totalCostUSD: Number(input.totalCostUSD.toFixed(4)),
    averageCellDurationMs: Math.round(averageDuration),
  };
}

export function dispatchSweepEvent(
  listeners: ReadonlySet<SweepEventListener>,
  sweepId: string,
  progress: SweepProgress,
  event: Omit<SweepEvent, "sweepId" | "timestamp" | "progress">,
): void {
  const fullEvent: SweepEvent = {
    ...event,
    sweepId,
    timestamp: new Date().toISOString(),
    progress,
  };
  for (const listener of listeners) {
    try {
      void listener(fullEvent);
    } catch {}
  }
}

export function resolveSweepIdentity(
  constructorSweepId: string | undefined,
  configuredSweepId: string,
  sanitize: (value: string) => string,
): string {
  const resolvedSweepId = sanitize(configuredSweepId);
  if (constructorSweepId !== undefined && constructorSweepId !== resolvedSweepId) {
    throw new TypeError("Conflicting sweep identities");
  }
  return resolvedSweepId;
}

import { rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { RunArtifactLayout } from "../infrastructure/workspace/types.js";
import type { RunRecord, RunStatus } from "../reporting/types.js";
import type { ScenarioResult, RunTerminationReason } from "../runner/types.js";
import type { ExecutionMode } from "../shared/execution-mode.js";

export interface RunEvidenceContext {
  readonly runId: string;
  readonly scenarioId: string;
  readonly category: string;
  readonly skillId: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly executionMode: ExecutionMode;
  readonly simulated: boolean;
  readonly startedAt: string;
}

export interface TerminalRunEvidence {
  readonly status: RunStatus;
  readonly terminationReason: RunTerminationReason;
  readonly completedAt: string;
}

export async function writeRunManifest(
  layout: RunArtifactLayout,
  context: RunEvidenceContext
): Promise<void> {
  await writeAtomicJson(layout.manifestPath, {
    ...context,
    timestamp: context.startedAt,
  });
}

export async function writeRunResult(
  layout: RunArtifactLayout,
  context: RunEvidenceContext,
  terminal: TerminalRunEvidence,
  result: ScenarioResult | undefined
): Promise<void> {
  await writeAtomicJson(layout.resultPath, {
    ...context,
    ...terminal,
    timestamp: terminal.completedAt,
    ...(result === undefined ? {} : {
      totalDurationMs: result.totalDurationMs,
      totalTokens: result.totalTokens.totalTokens,
      totalCostUSD: result.totalCostUSD,
      totalTurns: result.turns,
      toolErrorCount: countToolErrors(result),
    }),
  });
}

export function mapTerminalStatus(reason: RunTerminationReason): RunStatus {
  if (reason === "success") return "completed";
  if (reason === "timeout") return "timed_out";
  if (reason === "aborted") return "aborted";
  return "failed";
}

export function createTerminalRunRecord(
  context: RunEvidenceContext,
  terminal: TerminalRunEvidence,
  result: ScenarioResult | undefined
): RunRecord {
  const totalTokens = result?.totalTokens.totalTokens ?? 0;
  const cacheReadTokens = result?.totalTokens.cacheReadInputTokens ?? 0;
  const toolErrorCount = result === undefined ? 0 : countToolErrors(result);
  const evaluationEvidenceExists = false;
  const passedBenchmark = terminal.status === "completed"
    && toolErrorCount === 0
    && evaluationEvidenceExists;

  return {
    runId: context.runId,
    scenarioId: context.scenarioId,
    category: context.category,
    skillId: context.skillId,
    modelId: context.modelId,
    providerId: context.providerId,
    executionMode: context.executionMode,
    simulated: context.simulated,
    status: terminal.status,
    terminationReason: terminal.terminationReason,
    compositeScore: passedBenchmark ? 100 : 0,
    passedBenchmark,
    wallClockMs: result?.totalDurationMs ?? 0,
    totalTokens,
    cacheHitRatio: totalTokens > 0 ? cacheReadTokens / totalTokens : 0,
    totalCostUSD: result?.totalCostUSD ?? 0,
    totalTurns: result?.turns ?? 0,
    errorCount: toolErrorCount,
    startedAt: result?.startedAt ?? context.startedAt,
    completedAt: result?.finishedAt ?? terminal.completedAt,
  };
}

export function countToolErrors(result: ScenarioResult): number {
  return result.toolHistory.filter((record) => record.isError).length;
}

export function summarizeTerminalFailure(reason: RunTerminationReason): string {
  if (reason === "timeout") return "execution timed out";
  if (reason === "aborted") return "execution aborted";
  return "execution failed";
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  );
  await writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
  await rename(temporaryPath, path);
}

import { randomUUID } from "node:crypto";
import { existsSync, linkSync, lstatSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { link, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { RunArtifactLayout } from "../infrastructure/workspace/types.js";
import type { RunRecord, RunStatus } from "../reporting/types.js";
import type { ScenarioResult, RunTerminationReason } from "../runner/types.js";
import type { ExecutionMode } from "../shared/execution-mode.js";
import { sanitizeBenchmarkArtifactValue } from "../shared/artifact-sanitization.js";

export interface RunEvidenceContext {
  readonly sweepId: string;
  readonly planFingerprint: string;
  readonly cellId: string;
  readonly matrixOccurrenceIndex: number;
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

export class EvidenceCommitError extends Error {
  public readonly targetCommitted: boolean;

  public constructor(targetCommitted: boolean) {
    super("terminal evidence persistence failed");
    this.name = "EvidenceCommitError";
    this.targetCommitted = targetCommitted;
  }
}

export async function writeRunManifest(layout: RunArtifactLayout, context: RunEvidenceContext): Promise<void> {
  await writeAtomicJson(layout.manifestPath, { schemaVersion: "1.0.0", artifactKind: "manifest", ...context, timestamp: context.startedAt });
}

export function commitRunResult(
  layout: RunArtifactLayout,
  context: RunEvidenceContext,
  terminal: TerminalRunEvidence,
  result: ScenarioResult | undefined,
  attemptCount: number,
  durationMs: number
): void {
  commitAtomicJson(layout.resultPath, createRunResultValue(context, terminal, result, attemptCount, durationMs, "result"));
}

export function commitTerminalFailure(
  layout: RunArtifactLayout,
  context: RunEvidenceContext,
  terminal: TerminalRunEvidence,
  result: ScenarioResult | undefined,
  preferResultPath: boolean,
  attemptCount: number,
  durationMs: number
): string {
  if (preferResultPath) {
    try {
      commitAtomicJson(layout.resultPath, createRunResultValue(context, terminal, result, attemptCount, durationMs, "result"));
      return layout.resultPath;
    } catch (error) {
      if (error instanceof EvidenceCommitError && error.targetCommitted) throw error;
    }
  }
  commitAtomicJson(layout.terminalFailurePath, createRunResultValue(context, terminal, result, attemptCount, durationMs, "terminal-failure"));
  return layout.terminalFailurePath;
}

export function discardCommittedRunResult(layout: RunArtifactLayout): void {
  const stats = lstatSync(layout.resultPath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new EvidenceCommitError(true);
  unlinkSync(layout.resultPath);
}

export function removeStaleRunEvidenceTemporaryFiles(layout: RunArtifactLayout): void {
  if (!existsSync(layout.runDirectory)) return;
  for (const entry of readdirSync(layout.runDirectory)) {
    if (!isRunEvidenceTemporaryName(entry)) continue;
    const path = join(layout.runDirectory, entry);
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new TypeError("Terminal evidence temporary artifact is unsafe");
    unlinkSync(path);
  }
}

export function isRunEvidenceTemporaryName(name: string): boolean {
  const targets = ["manifest.json", "result.json", "terminal-failure.json"];
  return targets.some((target) => new RegExp(`^\\.${target.replace(".", "\\.")}\\.[0-9a-f-]{36}\\.tmp$`).test(name));
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
  result: ScenarioResult | undefined,
  attemptCount: number = 0,
  durationMs: number = result?.totalDurationMs ?? 0
): RunRecord {
  const totalTokens = result?.totalTokens.totalTokens ?? 0;
  const cacheReadTokens = result?.totalTokens.cacheReadInputTokens ?? 0;
  const toolErrorCount = result === undefined ? 0 : countToolErrors(result);
  const evaluationEvidenceExists = false;
  const passedBenchmark = terminal.status === "completed" && toolErrorCount === 0 && evaluationEvidenceExists;
  return {
    sweepId: context.sweepId,
    planFingerprint: context.planFingerprint,
    cellId: context.cellId,
    matrixOccurrenceIndex: context.matrixOccurrenceIndex,
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
    wallClockMs: durationMs,
    totalTokens,
    cacheHitRatio: totalTokens > 0 ? cacheReadTokens / totalTokens : 0,
    totalCostUSD: result?.totalCostUSD ?? 0,
    totalTurns: result?.turns ?? 0,
    errorCount: toolErrorCount,
    attemptCount,
    startedAt: context.startedAt,
    completedAt: terminal.completedAt,
  };
}

export function countToolErrors(result: ScenarioResult): number {
  return result.toolHistory.filter((record) => record.isError).length;
}

export function summarizeTerminalFailure(reason: RunTerminationReason): string {
  if (reason === "timeout") return "execution timed out";
  if (reason === "aborted") return "execution aborted";
  if (reason === "persistence_failed") return "terminal evidence persistence failed";
  return "execution failed";
}

function createRunResultValue(
  context: RunEvidenceContext,
  terminal: TerminalRunEvidence,
  result: ScenarioResult | undefined,
  attemptCount: number,
  durationMs: number,
  artifactKind: "result" | "terminal-failure"
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: "1.0.0",
    artifactKind,
    ...context,
    ...terminal,
    attemptCount,
    passedBenchmark: false,
    timestamp: terminal.completedAt,
    ...(result === undefined ? {} : {
      scenarioStartedAt: result.startedAt,
      scenarioCompletedAt: result.finishedAt,
    }),
    totalDurationMs: durationMs,
    totalTokens: result?.totalTokens.totalTokens ?? 0,
    usageBreakdown: result?.totalTokens ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
    },
    totalCostUSD: result?.totalCostUSD ?? 0,
    totalTurns: result?.turns ?? 0,
    toolErrorCount: result === undefined ? 0 : countToolErrors(result),
  };
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = createTemporaryPath(path);
  let targetCommitted = false;
  try {
    await writeFile(temporaryPath, serializeEvidence(value), { encoding: "utf8", flag: "wx" });
    await link(temporaryPath, path);
    targetCommitted = true;
  } catch {
    throw new EvidenceCommitError(targetCommitted);
  } finally {
    try {
      await rm(temporaryPath, { force: true });
    } catch {
      throw new EvidenceCommitError(targetCommitted);
    }
  }
}

function commitAtomicJson(path: string, value: unknown): void {
  const temporaryPath = createTemporaryPath(path);
  let targetCommitted = false;
  try {
    writeFileSync(temporaryPath, serializeEvidence(value), { encoding: "utf8", flag: "wx" });
    linkSync(temporaryPath, path);
    targetCommitted = true;
  } catch {
    throw new EvidenceCommitError(targetCommitted);
  } finally {
    if (existsSync(temporaryPath)) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        throw new EvidenceCommitError(targetCommitted);
      }
    }
  }
}

function createTemporaryPath(path: string): string {
  return join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
}

function serializeEvidence(value: unknown): string {
  return JSON.stringify(sanitizeBenchmarkArtifactValue(value), null, 2);
}

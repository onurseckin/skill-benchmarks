import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import type { RunArtifactLayout } from "../infrastructure/workspace/types.js";
import type { RunRecord, RunStatus } from "../reporting/types.js";
import type { ScenarioResult, RunTerminationReason } from "../runner/types.js";
import type { ExecutionMode } from "../shared/execution-mode.js";
import { classifyBenchmarkAuthority } from "../shared/benchmark-authority.js";
import {
  commitAtomicEvidenceJson,
  EvidenceCommitError,
  removeAtomicEvidence,
  writeAtomicEvidenceJson,
  type EvidenceArtifactIdentity,
} from "./atomic-evidence-writer.js";

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
  readonly dryRun: boolean;
  readonly startedAt: string;
}

export interface TerminalRunEvidence {
  readonly status: RunStatus;
  readonly terminationReason: RunTerminationReason;
  readonly completedAt: string;
}

export { EvidenceCommitError } from "./atomic-evidence-writer.js";

export async function writeRunManifest(
  layout: RunArtifactLayout,
  context: RunEvidenceContext,
): Promise<void> {
  await writeAtomicEvidenceJson(layout, layout.manifestPath, {
    schemaVersion: "1.0.0",
    artifactKind: "manifest",
    ...context,
    timestamp: context.startedAt,
  });
}

export function commitRunResult(
  layout: RunArtifactLayout,
  context: RunEvidenceContext,
  terminal: TerminalRunEvidence,
  result: ScenarioResult | undefined,
  attemptCount: number,
  durationMs: number,
): EvidenceArtifactIdentity {
  return commitAtomicEvidenceJson(
    layout,
    layout.resultPath,
    createRunResultValue(context, terminal, result, attemptCount, durationMs, "result"),
  );
}

export function commitTerminalFailure(
  layout: RunArtifactLayout,
  context: RunEvidenceContext,
  terminal: TerminalRunEvidence,
  result: ScenarioResult | undefined,
  preferResultPath: boolean,
  attemptCount: number,
  durationMs: number,
): string {
  if (preferResultPath) {
    try {
      commitAtomicEvidenceJson(
        layout,
        layout.resultPath,
        createRunResultValue(context, terminal, result, attemptCount, durationMs, "result"),
      );
      return layout.resultPath;
    } catch (error) {
      if (error instanceof EvidenceCommitError && error.targetCommitted) throw error;
    }
  }
  commitAtomicEvidenceJson(
    layout,
    layout.terminalFailurePath,
    createRunResultValue(context, terminal, result, attemptCount, durationMs, "terminal-failure"),
  );
  return layout.terminalFailurePath;
}

export function discardCommittedRunResult(
  layout: RunArtifactLayout,
  expectedIdentity: EvidenceArtifactIdentity,
): void {
  removeAtomicEvidence(layout, layout.resultPath, expectedIdentity);
}

export function removeStaleRunEvidenceTemporaryFiles(layout: RunArtifactLayout): void {
  if (!existsSync(layout.runDirectory)) return;
  for (const entry of readdirSync(layout.runDirectory)) {
    if (!isRunEvidenceTemporaryName(entry)) continue;
    const path = join(layout.runDirectory, entry);
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink())
      throw new TypeError("Terminal evidence temporary artifact is unsafe");
    unlinkSync(path);
    syncRunDirectory(layout.runDirectory);
  }
}

function syncRunDirectory(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function isRunEvidenceTemporaryName(name: string): boolean {
  const targets = ["manifest.json", "result.json", "terminal-failure.json"];
  return targets.some((target) =>
    new RegExp(`^\\.${target.replace(".", "\\.")}\\.[0-9a-f-]{36}\\.tmp$`).test(name),
  );
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
  durationMs: number = result?.totalDurationMs ?? 0,
): RunRecord {
  const totalTokens = result?.totalTokens.totalTokens ?? 0;
  const cacheReadTokens = result?.totalTokens.cacheReadInputTokens ?? 0;
  const toolErrorCount = result === undefined ? 0 : countToolErrors(result);
  const authority = createTerminalAuthority(context, terminal, result);
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
    dryRun: context.dryRun,
    status: terminal.status,
    terminationReason: terminal.terminationReason,
    ...authority,
    wallClockMs: durationMs,
    totalTokens,
    cacheHitRatio: totalTokens > 0 ? cacheReadTokens / totalTokens : 0,
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
  artifactKind: "result" | "terminal-failure",
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: "2.0.0",
    artifactKind,
    ...context,
    ...terminal,
    attemptCount,
    ...createTerminalAuthority(context, terminal, result),
    timestamp: terminal.completedAt,
    ...(result === undefined
      ? {}
      : {
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
    totalTurns: result?.turns ?? 0,
    toolErrorCount: result === undefined ? 0 : countToolErrors(result),
  };
}

function createTerminalAuthority(
  context: RunEvidenceContext,
  terminal: TerminalRunEvidence,
  result: ScenarioResult | undefined,
) {
  const evidence = {
    status: "unavailable" as const,
    requiredChecksDeclared: 0,
    requiredChecksExecuted: 0,
    requiredChecksPassed: 0,
    artifactIntegrity: "unverified" as const,
  };
  return classifyBenchmarkAuthority({
    executionMode: context.executionMode,
    simulated: context.simulated,
    dryRun: context.dryRun,
    lifecycleStatus: terminal.status,
    terminationReason: terminal.terminationReason,
    expectedIdentity: {
      runId: context.runId,
      scenarioId: context.scenarioId,
      skillId: context.skillId,
      modelId: context.modelId,
      providerId: context.providerId,
      workspaceFingerprint: "",
    },
    evidence,
    evaluation: { status: "not_evaluated", reasons: ["evaluation_missing"] },
    operationalCost:
      context.executionMode === "fake" || context.simulated || context.dryRun
        ? { status: "simulated_zero", amountUSD: 0 }
        : { status: "unverified", amountUSD: result?.totalCostUSD ?? 0 },
  });
}

import type { IContainerInstance } from "../infrastructure/container/types.js";
import { createDisposableWorkspace } from "../infrastructure/workspace/disposable-workspace.js";
import { createRunArtifactLayout, prepareRunArtifactLayout } from "../infrastructure/workspace/run-artifact-layout.js";
import type { DisposableWorkspace } from "../infrastructure/workspace/types.js";
import { createProviderAdapter } from "../providers/factory.js";
import { TelemetryDatabase, TerminalRunIdentityConflictError } from "../reporting/db.js";
import type { ScenarioResult, RunTerminationReason } from "../runner/types.js";
import { ScenarioRunnerEngine } from "../runner/runner-engine.js";
import { ScenarioLoader } from "../runner/scenario-loader.js";
import { createSafeArtifactPathSegment } from "../shared/artifact-sanitization.js";
import type { ITokenBucketRateLimiter, MatrixCellDescriptor, MatrixCellResult, MatrixSweepConfig } from "./types.js";
import {
  EvidenceCommitError,
  commitRunResult,
  commitTerminalFailure,
  createTerminalRunRecord,
  discardCommittedRunResult,
  mapTerminalStatus,
  summarizeTerminalFailure,
  writeRunManifest,
} from "./run-evidence.js";

interface CellExecutionInput {
  readonly cell: MatrixCellDescriptor;
  readonly config: MatrixSweepConfig;
  readonly scenarioLoader: ScenarioLoader;
  readonly runnerEngine: ScenarioRunnerEngine;
  readonly telemetryDb: TelemetryDatabase;
  readonly limiter: ITokenBucketRateLimiter;
  readonly aborted: () => boolean;
  readonly planFingerprint: string;
}

export async function executeSweepCell(input: CellExecutionInput): Promise<MatrixCellResult> {
  const { cell, config, scenarioLoader, runnerEngine, telemetryDb, limiter, aborted, planFingerprint } = input;
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const executionMode = config.dryRun ? "fake" : cell.executionMode;
  const baseContext = {
    sweepId: cell.sweepId,
    planFingerprint,
    cellId: cell.cellId,
    matrixOccurrenceIndex: cell.matrixOccurrenceIndex,
    runId: cell.runId,
    scenarioId: cell.scenarioId,
    category: "unknown",
    skillId: cell.skillId,
    modelId: cell.modelId,
    providerId: cell.providerId,
    executionMode,
    simulated: executionMode === "fake",
    startedAt,
  } as const;
  let artifactLayout = createCellArtifactLayout(cell);
  try {
    telemetryDb.claimRunIdentity(cell.runId, cell.sweepId, cell.cellId);
  } catch (error) {
    if (!(error instanceof TerminalRunIdentityConflictError)) throw error;
    return createTerminalIdentityConflict(cell, startedAt, startedMs);
  }
  let scenarioResult: ScenarioResult | undefined;
  let evidenceCategory = "unknown";
  let attemptCount = 0;
  let infrastructureFailure: RunTerminationReason | undefined;
  let workspace: DisposableWorkspace | undefined;

  try {
    artifactLayout = await prepareRunArtifactLayout(artifactLayout);
    assertEmbeddedAdapterMatchesMode(cell, executionMode);
    const scenarioDefinition = scenarioLoader.loadScenario(cell.scenarioId);
    evidenceCategory = scenarioDefinition.category;
    const context = { ...baseContext, category: evidenceCategory };
    try {
      await writeRunManifest(artifactLayout, context);
    } catch {
      return persistTerminalFailure(cell, telemetryDb, artifactLayout, context, scenarioResult, attemptCount, startedMs);
    }
    workspace = await createDisposableWorkspace({
      outputRoot: cell.outputRoot,
      runId: cell.runId,
      scenarioId: cell.scenarioId,
      fixtures: scenarioDefinition.workspace?.fixtures ?? {},
    });
    const maxRetries = config.maxRetriesPerCell ?? 2;

    while (attemptCount <= maxRetries) {
      if (aborted()) break;
      attemptCount += 1;
      let container: IContainerInstance | undefined;
      let attemptFailed = false;
      try {
        await limiter.acquire(2000);
        if (aborted()) break;
        if (config.containerPool) {
          container = await config.containerPool.acquire({
            imageTag: "skill-benchmarks-sandbox:latest",
            runId: cell.runId,
            scenarioId: cell.scenarioId,
            resourceLimits: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
            networkMode: "sb-bridge-isolated",
            workspaceVolumeName: `sb-vol-${cell.runId}`,
            artifactHostPath: artifactLayout.runDirectory,
            timeouts: { commandTimeoutMs: cell.limits.toolTimeoutMs, turnTimeoutMs: 60000, totalScenarioTimeoutMs: cell.limits.maxWallClockTimeMs },
            labels: { "io.skill-benchmarks.sweep-id": cell.runId },
          });
        }
        scenarioResult = config.dryRun
          ? createDryRunResult(cell, startedAt)
          : await runnerEngine.run({
            runId: cell.runId,
            scenarioId: cell.scenarioId,
            skillIds: [cell.skillId],
            modelId: cell.modelId,
            provider: createProviderAdapter({
              providerId: cell.providerId as "anthropic" | "google" | "openai" | "ollama" | "custom",
              defaultModel: cell.modelId,
              executionMode: cell.executionMode,
              runId: cell.runId,
            }),
            prompt: scenarioDefinition.instructions,
            workspace,
            artifactOutputDir: artifactLayout.runDirectory,
            artifactLayout,
            container,
            limits: cell.limits,
            temperature: cell.temperature,
            thinkingLevel: cell.thinkingLevel,
            thinkingBudget: cell.thinkingBudget,
            reasoningEffort: cell.modelEntry.reasoningEffort,
          });
        limiter.recordConsumption(scenarioResult.totalTokens.totalTokens);
      } catch {
        attemptFailed = true;
      } finally {
        if (container && config.containerPool) {
          try {
            await config.containerPool.release(container);
          } catch {
            infrastructureFailure = "error";
          }
        }
      }
      if (infrastructureFailure || scenarioResult !== undefined || aborted()) break;
      if (attemptFailed && attemptCount <= maxRetries) {
        try {
          await limiter.reportRateLimitViolation();
        } catch {
          infrastructureFailure = "error";
        }
      } else {
        break;
      }
    }
  } catch {
    infrastructureFailure = "error";
  } finally {
    if (workspace !== undefined) {
      try {
        await workspace.dispose();
      } catch {
        infrastructureFailure = "error";
      }
    }
  }

  const context = { ...baseContext, category: evidenceCategory };
  const terminationReason = resolveTerminationReason(infrastructureFailure, scenarioResult, aborted());
  return persistTerminalCell({
    cell,
    telemetryDb,
    artifactLayout,
    context,
    scenarioResult,
    attemptCount,
    terminationReason,
    startedMs,
  });
}

function createTerminalIdentityConflict(
  cell: MatrixCellDescriptor,
  startedAt: string,
  startedMs: number
): MatrixCellResult {
  return {
    cell,
    status: "failed",
    attemptCount: 0,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    executionCompleted: false,
    passedBenchmark: false,
    error: "terminal run identity already exists",
    terminalIdentityConflict: true,
    retryable: false,
  };
}

interface PersistTerminalCellInput {
  readonly cell: MatrixCellDescriptor;
  readonly telemetryDb: TelemetryDatabase;
  readonly artifactLayout: ReturnType<typeof createRunArtifactLayout>;
  readonly context: Parameters<typeof createTerminalRunRecord>[0];
  readonly scenarioResult?: ScenarioResult;
  readonly attemptCount: number;
  readonly terminationReason: RunTerminationReason;
  readonly startedMs: number;
}

function persistTerminalCell(input: PersistTerminalCellInput): MatrixCellResult {
  const scenarioResult = normalizeScenarioResult(input.context, input.scenarioResult);
  const durationMs = scenarioResult?.totalDurationMs ?? Date.now() - input.startedMs;
  const terminal = {
    status: mapTerminalStatus(input.terminationReason),
    terminationReason: input.terminationReason,
    completedAt: scenarioResult?.finishedAt ?? new Date().toISOString(),
  } as const;
  const runRecord = createTerminalRunRecord(input.context, terminal, scenarioResult, input.attemptCount, durationMs);
  let resultIdentity: ReturnType<typeof commitRunResult> | undefined;
  try {
    input.telemetryDb.saveRunRecordWithArtifact(runRecord, () => {
      resultIdentity = commitRunResult(
        input.artifactLayout,
        input.context,
        terminal,
        scenarioResult,
        input.attemptCount,
        durationMs
      );
    });
  } catch (error) {
    if (error instanceof TerminalRunIdentityConflictError) {
      return createTerminalIdentityConflict(input.cell, input.context.startedAt, input.startedMs);
    }
    const committedIdentity = resultIdentity ?? (error instanceof EvidenceCommitError ? error.committedIdentity : undefined);
    const targetCommitted = committedIdentity !== undefined;
    if (targetCommitted) {
      try {
        discardCommittedRunResult(input.artifactLayout, committedIdentity);
      } catch {
        return createPersistenceFailureResult(input, scenarioResult, false);
      }
    }
    return createPersistenceFailureResult(input, scenarioResult, targetCommitted);
  }
  return createCellResult(input, scenarioResult, runRecord, terminal.terminationReason);
}

function persistTerminalFailure(
  cell: MatrixCellDescriptor,
  telemetryDb: TelemetryDatabase,
  artifactLayout: ReturnType<typeof createRunArtifactLayout>,
  context: Parameters<typeof createTerminalRunRecord>[0],
  scenarioResult: ScenarioResult | undefined,
  attemptCount: number,
  startedMs: number
): MatrixCellResult {
  return createPersistenceFailureResult({
    cell, telemetryDb, artifactLayout, context, scenarioResult,
    attemptCount, terminationReason: "persistence_failed", startedMs,
  }, scenarioResult, true);
}

function createPersistenceFailureResult(
  input: PersistTerminalCellInput,
  scenarioResult: ScenarioResult | undefined,
  preferResultPath: boolean
): MatrixCellResult {
  const terminal = { status: "failed", terminationReason: "persistence_failed", completedAt: new Date().toISOString() } as const;
  const durationMs = scenarioResult?.totalDurationMs ?? Date.now() - input.startedMs;
  const runRecord = createTerminalRunRecord(input.context, terminal, scenarioResult, input.attemptCount, durationMs);
  let failureArtifactDurable = false;
  try {
    commitTerminalFailure(input.artifactLayout, input.context, terminal, scenarioResult, preferResultPath, input.attemptCount, durationMs);
    failureArtifactDurable = true;
  } catch {
    failureArtifactDurable = false;
  }
  let databaseRecordDurable = false;
  try {
    input.telemetryDb.saveRunRecord(runRecord);
    databaseRecordDurable = true;
  } catch {
    databaseRecordDurable = false;
  }
  const result = createCellResult(input, scenarioResult, runRecord, terminal.terminationReason);
  const { scenarioResult: executionResult, ...terminalResult } = result;
  const publicResult = executionResult === undefined ? result : terminalResult;
  if (!failureArtifactDurable || !databaseRecordDurable) return { ...publicResult, retryable: false };
  return publicResult;
}

function createCellResult(
  input: PersistTerminalCellInput,
  scenarioResult: ScenarioResult | undefined,
  runRecord: ReturnType<typeof createTerminalRunRecord>,
  terminationReason: RunTerminationReason
): MatrixCellResult {
  const executionCompleted = runRecord.status === "completed";
  return {
    cell: input.cell,
    status: executionCompleted ? "completed" : "failed",
    attemptCount: input.attemptCount,
    startedAt: input.context.startedAt,
    completedAt: runRecord.completedAt,
    durationMs: runRecord.wallClockMs,
    scenarioResult,
    runRecord,
    error: executionCompleted ? undefined : summarizeTerminalFailure(terminationReason),
    retryable: false,
    executionCompleted,
    passedBenchmark: runRecord.passedBenchmark,
  };
}

function resolveTerminationReason(
  infrastructureFailure: RunTerminationReason | undefined,
  scenarioResult: ScenarioResult | undefined,
  aborted: boolean
): RunTerminationReason {
  if (infrastructureFailure !== undefined) return infrastructureFailure;
  if (scenarioResult?.terminationReason === "timeout") return "timeout";
  if (aborted) return "aborted";
  if (scenarioResult !== undefined) return scenarioResult.terminationReason;
  return "error";
}

function normalizeScenarioResult(
  context: Parameters<typeof createTerminalRunRecord>[0],
  result: ScenarioResult | undefined
): ScenarioResult | undefined {
  if (result === undefined) return undefined;
  return {
    ...result,
    executionMode: context.executionMode,
    simulated: context.simulated,
    totalCostUSD: context.executionMode === "fake" ? 0 : result.totalCostUSD,
  };
}

function createDryRunResult(cell: MatrixCellDescriptor, startedAt: string): ScenarioResult {
  const finishedAt = new Date().toISOString();
  return {
    runId: cell.runId,
    scenarioId: cell.scenarioId,
    skillIds: [cell.skillId],
    modelId: cell.modelId,
    executionMode: "fake",
    simulated: true,
    terminationReason: "success",
    completed: true,
    turns: 2,
    turnHistory: [],
    toolHistory: [],
    messages: [],
    finalOutput: "Dry run completed",
    totalDurationMs: 50,
    totalTokens: { inputTokens: 500, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, totalTokens: 700 },
    totalCostUSD: 0,
    consecutiveToolErrors: 0,
    startedAt,
    finishedAt,
  };
}

function createCellArtifactLayout(cell: MatrixCellDescriptor) {
  try {
    return createRunArtifactLayout(cell.outputRoot, cell.runId);
  } catch {
    const fallbackRunId = createSafeArtifactPathSegment(`${cell.cellId}-${cell.runId}`, "failed-run");
    return createRunArtifactLayout(cell.outputRoot, fallbackRunId);
  }
}

function assertEmbeddedAdapterMatchesMode(cell: MatrixCellDescriptor, executionMode: "fake" | "live"): void {
  const embeddedAdapter = cell.modelEntry.provider;
  if (embeddedAdapter === undefined) return;
  const expectedSimulated = executionMode === "fake";
  if (embeddedAdapter.executionMode !== executionMode || embeddedAdapter.simulated !== expectedSimulated) {
    throw new TypeError("Embedded provider mode does not match resolved benchmark mode");
  }
}

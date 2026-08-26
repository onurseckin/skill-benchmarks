import type { IContainerInstance } from "../infrastructure/container/types.js";
import { createDisposableWorkspace } from "../infrastructure/workspace/disposable-workspace.js";
import {
  createRunArtifactLayout,
  prepareRunArtifactLayout,
} from "../infrastructure/workspace/run-artifact-layout.js";
import type { DisposableWorkspace } from "../infrastructure/workspace/types.js";
import { createProviderAdapter } from "../providers/factory.js";
import { TelemetryDatabase, TerminalRunIdentityConflictError } from "../reporting/db.js";
import type { ScenarioResult, RunTerminationReason } from "../runner/types.js";
import { ScenarioRunnerEngine } from "../runner/runner-engine.js";
import { ScenarioLoader } from "../runner/scenario-loader.js";
import { createSafeArtifactPathSegment } from "../shared/artifact-sanitization.js";
import type {
  ITokenBucketRateLimiter,
  MatrixCellDescriptor,
  MatrixCellResult,
  MatrixSweepConfig,
} from "./types.js";
import { writeRunManifest } from "./run-evidence.js";
import {
  createTerminalIdentityConflict,
  persistTerminalCell,
  persistTerminalFailure,
} from "./terminal-cell-persistence.js";

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
  const {
    cell,
    config,
    scenarioLoader,
    runnerEngine,
    telemetryDb,
    limiter,
    aborted,
    planFingerprint,
  } = input;
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
    dryRun: config.dryRun === true,
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
      return persistTerminalFailure(
        cell,
        telemetryDb,
        artifactLayout,
        context,
        scenarioResult,
        attemptCount,
        startedMs,
      );
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
            timeouts: {
              commandTimeoutMs: cell.limits.toolTimeoutMs,
              turnTimeoutMs: 60000,
              totalScenarioTimeoutMs: cell.limits.maxWallClockTimeMs,
            },
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
                providerId: cell.providerId as
                  | "anthropic"
                  | "google"
                  | "openai"
                  | "ollama"
                  | "custom",
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
  const terminationReason = resolveTerminationReason(
    infrastructureFailure,
    scenarioResult,
    aborted(),
  );
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

function resolveTerminationReason(
  infrastructureFailure: RunTerminationReason | undefined,
  scenarioResult: ScenarioResult | undefined,
  aborted: boolean,
): RunTerminationReason {
  if (infrastructureFailure !== undefined) return infrastructureFailure;
  if (scenarioResult?.terminationReason === "timeout") return "timeout";
  if (aborted) return "aborted";
  if (scenarioResult !== undefined) return scenarioResult.terminationReason;
  return "error";
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
    totalTokens: {
      inputTokens: 500,
      outputTokens: 200,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 700,
    },
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
    const fallbackRunId = createSafeArtifactPathSegment(
      `${cell.cellId}-${cell.runId}`,
      "failed-run",
    );
    return createRunArtifactLayout(cell.outputRoot, fallbackRunId);
  }
}

function assertEmbeddedAdapterMatchesMode(
  cell: MatrixCellDescriptor,
  executionMode: "fake" | "live",
): void {
  const embeddedAdapter = cell.modelEntry.provider;
  if (embeddedAdapter === undefined) return;
  const expectedSimulated = executionMode === "fake";
  if (
    embeddedAdapter.executionMode !== executionMode ||
    embeddedAdapter.simulated !== expectedSimulated
  ) {
    throw new TypeError("Embedded provider mode does not match resolved benchmark mode");
  }
}

import type { IContainerInstance } from "../infrastructure/container/types.js";
import { createDisposableWorkspace } from "../infrastructure/workspace/disposable-workspace.js";
import { createRunArtifactLayout, prepareRunArtifactLayout } from "../infrastructure/workspace/run-artifact-layout.js";
import { createProviderAdapter } from "../providers/factory.js";
import { TelemetryDatabase } from "../reporting/db.js";
import type { ScenarioResult } from "../runner/types.js";
import { ScenarioRunnerEngine } from "../runner/runner-engine.js";
import { ScenarioLoader } from "../runner/scenario-loader.js";
import { createSafeArtifactPathSegment } from "../shared/artifact-sanitization.js";
import type { ITokenBucketRateLimiter, MatrixCellDescriptor, MatrixCellResult, MatrixSweepConfig } from "./types.js";
import { createTerminalRunRecord, mapTerminalStatus, summarizeTerminalFailure, writeRunManifest, writeRunResult } from "./run-evidence.js";

interface CellExecutionInput {
  readonly cell: MatrixCellDescriptor;
  readonly config: MatrixSweepConfig;
  readonly scenarioLoader: ScenarioLoader;
  readonly runnerEngine: ScenarioRunnerEngine;
  readonly telemetryDb: TelemetryDatabase;
  readonly limiter: ITokenBucketRateLimiter;
  readonly aborted: () => boolean;
}

export async function executeSweepCell(input: CellExecutionInput): Promise<MatrixCellResult> {
  const { cell, config, scenarioLoader, runnerEngine, telemetryDb, limiter, aborted } = input;
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const executionMode = config.dryRun ? "fake" : cell.executionMode;
  const evidenceContext = {
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
  const artifactLayout = createCellArtifactLayout(cell);
  let scenarioResult: ScenarioResult | undefined;
  let container: IContainerInstance | undefined;
  let attemptCount = 0;
  let manifestWritten = false;
  let evidenceCategory = "unknown";

  try {
    await prepareRunArtifactLayout(artifactLayout);
    const scenarioDefinition = scenarioLoader.loadScenario(cell.scenarioId);
    evidenceCategory = scenarioDefinition.category;
    const contextualEvidence = { ...evidenceContext, category: evidenceCategory };
    await writeRunManifest(artifactLayout, contextualEvidence);
    manifestWritten = true;
    const workspace = await createDisposableWorkspace({
      outputRoot: cell.outputRoot,
      runId: cell.runId,
      scenarioId: cell.scenarioId,
      fixtures: scenarioDefinition.workspace?.fixtures ?? {},
    });
    const maxRetries = config.maxRetriesPerCell ?? 2;

    while (attemptCount <= maxRetries) {
      attemptCount += 1;
      try {
        if (aborted()) break;
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
            provider: config.runtimeConfig.requestedProviderId === undefined && cell.modelEntry.provider !== undefined
              ? cell.modelEntry.provider
              : createProviderAdapter({
                providerId: cell.providerId as "anthropic" | "google" | "openai" | "ollama" | "custom",
                defaultModel: cell.modelId,
                executionMode: cell.executionMode,
                runId: cell.runId,
              }),
            prompt: scenarioDefinition.instructions,
            workspace,
            container,
            limits: cell.limits,
            temperature: cell.temperature,
            thinkingLevel: cell.thinkingLevel,
            thinkingBudget: cell.thinkingBudget,
            reasoningEffort: cell.modelEntry.reasoningEffort,
          });
        limiter.recordConsumption(scenarioResult.totalTokens.totalTokens);
        if (scenarioResult.completed) {
          return persistTerminalCell({
            cell,
            telemetryDb,
            artifactLayout,
            context: { ...evidenceContext, category: evidenceCategory },
            scenarioResult,
            attemptCount,
          });
        }
        break;
      } catch {
        if (attemptCount > maxRetries || aborted()) break;
        await limiter.reportRateLimitViolation();
      } finally {
        if (container && config.containerPool) {
          await config.containerPool.release(container);
          container = undefined;
        }
      }
    }
  } catch {
  }

  const terminationReason = scenarioResult?.terminationReason ?? (aborted() ? "aborted" : "error");
  if (!manifestWritten) {
    try {
      await writeRunManifest(artifactLayout, { ...evidenceContext, category: evidenceCategory });
    } catch {
    }
  }
  return persistTerminalCell({
    cell,
    telemetryDb,
    artifactLayout,
    context: { ...evidenceContext, category: evidenceCategory },
    scenarioResult,
    attemptCount,
    terminationReason,
    startedMs,
  });
}

interface PersistTerminalCellInput {
  readonly cell: MatrixCellDescriptor;
  readonly telemetryDb: TelemetryDatabase;
  readonly artifactLayout: ReturnType<typeof createRunArtifactLayout>;
  readonly context: Parameters<typeof createTerminalRunRecord>[0];
  readonly scenarioResult?: ScenarioResult;
  readonly attemptCount: number;
  readonly terminationReason?: ScenarioResult["terminationReason"];
  readonly startedMs?: number;
}

async function persistTerminalCell(input: PersistTerminalCellInput): Promise<MatrixCellResult> {
  const terminationReason = input.terminationReason ?? input.scenarioResult?.terminationReason ?? "error";
  const terminal = {
    status: mapTerminalStatus(terminationReason),
    terminationReason,
    completedAt: input.scenarioResult?.finishedAt ?? new Date().toISOString(),
  } as const;
  const runRecord = createTerminalRunRecord(input.context, terminal, input.scenarioResult);
  input.telemetryDb.saveRunRecord(runRecord);
  try {
    await writeRunResult(input.artifactLayout, input.context, terminal, input.scenarioResult);
  } catch {
  }
  const executionCompleted = terminal.status === "completed";
  return {
    cell: input.cell,
    status: executionCompleted ? "completed" : "failed",
    attemptCount: input.attemptCount,
    startedAt: input.context.startedAt,
    completedAt: terminal.completedAt,
    durationMs: input.scenarioResult?.totalDurationMs ?? Date.now() - (input.startedMs ?? Date.now()),
    scenarioResult: input.scenarioResult,
    runRecord,
    error: executionCompleted ? undefined : summarizeTerminalFailure(terminationReason),
    retryable: false,
    executionCompleted,
    passedBenchmark: runRecord.passedBenchmark,
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

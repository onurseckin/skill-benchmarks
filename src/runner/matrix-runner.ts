import { randomUUID } from "node:crypto";
import type {
  ExecutionLimits,
  LLMProviderAdapter,
  MatrixExecutionConfig,
  MatrixExecutionSummary,
  ScenarioResult,
  ScenarioRunConfig,
  StreamCollector,
  TokenUsage,
} from "./types.js";
import { ScenarioRunnerEngine } from "./runner-engine.js";
import { StandardToolDispatcher } from "./tool-dispatcher.js";
import type {
  IContainerInstance,
  IContainerPoolManager,
  ContainerLaunchConfig,
} from "../infrastructure/container/types.js";

export function aggregateTokens(usages: ReadonlyArray<TokenUsage>): TokenUsage {
  return usages.reduce(
    (acc, curr) => ({
      inputTokens: acc.inputTokens + curr.inputTokens,
      outputTokens: acc.outputTokens + curr.outputTokens,
      cacheCreationInputTokens:
        acc.cacheCreationInputTokens + curr.cacheCreationInputTokens,
      cacheReadInputTokens:
        acc.cacheReadInputTokens + curr.cacheReadInputTokens,
      totalTokens: acc.totalTokens + curr.totalTokens,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
    }
  );
}

export interface MatrixCellDescriptor {
  readonly cellId: string;
  readonly scenarioId: string;
  readonly skillIds: ReadonlyArray<string>;
  readonly modelId: string;
  readonly provider: LLMProviderAdapter;
  readonly thinkingLevel?: "none" | "low" | "medium" | "high" | "max";
  readonly repetitionIndex: number;
}

export function generateMatrixPermutations(
  config: MatrixExecutionConfig
): ReadonlyArray<MatrixCellDescriptor> {
  const cells: MatrixCellDescriptor[] = [];
  const repetitions = Math.max(1, config.repetitions);
  const thinkingLevels = config.thinkingLevels !== undefined && config.thinkingLevels.length > 0
    ? config.thinkingLevels
    : [undefined];

  for (const scenarioId of config.scenarioIds) {
    for (const model of config.models) {
      for (const thinkingLevel of thinkingLevels) {
        for (let rep = 0; rep < repetitions; rep++) {
          const thinkSuffix = thinkingLevel !== undefined ? `-th_${thinkingLevel}` : "";
          cells.push({
            cellId: `${scenarioId}-${model.modelId}${thinkSuffix}-r${rep}`,
            scenarioId,
            skillIds: config.skillIds,
            modelId: model.modelId,
            provider: model.provider,
            thinkingLevel,
            repetitionIndex: rep,
          });
        }
      }
    }
  }

  return cells;
}

export interface MatrixRunnerOptions {
  readonly toolDispatcher?: StandardToolDispatcher;
  readonly runnerEngine?: ScenarioRunnerEngine;
  readonly onCellStart?: (cell: MatrixCellDescriptor, runId: string) => void;
  readonly onCellComplete?: (
    cell: MatrixCellDescriptor,
    result: ScenarioResult
  ) => void;
}

export class MatrixRunner {
  private readonly runnerEngine: ScenarioRunnerEngine;
  private readonly toolDispatcher: StandardToolDispatcher;
  private readonly options?: MatrixRunnerOptions;

  constructor(options?: MatrixRunnerOptions) {
    this.toolDispatcher =
      options?.toolDispatcher ?? new StandardToolDispatcher();
    this.runnerEngine =
      options?.runnerEngine ?? new ScenarioRunnerEngine(this.toolDispatcher);
    this.options = options;
  }

  public getToolDispatcher(): StandardToolDispatcher {
    return this.toolDispatcher;
  }

  public getRunnerEngine(): ScenarioRunnerEngine {
    return this.runnerEngine;
  }

  public async runMatrix(
    config: MatrixExecutionConfig,
    collectorFactory?: (cell: MatrixCellDescriptor) => StreamCollector
  ): Promise<MatrixExecutionSummary> {
    const startTime = performance.now();
    const permutations = generateMatrixPermutations(config);
    const concurrency = Math.max(1, config.concurrency ?? 4);
    const results: ScenarioResult[] = new Array(permutations.length);

    let nextIndex = 0;
    const workerCount = Math.min(concurrency, permutations.length);

    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < permutations.length) {
        const index = nextIndex++;
        const cell = permutations[index];
        if (cell === undefined) {
          break;
        }
        results[index] = await this.executeCell(
          cell,
          config,
          collectorFactory
        );
      }
    });

    await Promise.all(workers);

    const totalRuns = results.length;
    const successfulRuns = results.filter(
      (r) => r.completed && r.terminationReason === "success"
    ).length;
    const failedRuns = totalRuns - successfulRuns;
    const totalDurationMs =
      Math.round((performance.now() - startTime) * 100) / 100;
    const rawCost = results.reduce((acc, r) => acc + r.totalCostUSD, 0);
    const totalCostUSD = Math.round(rawCost * 1000000) / 1000000;
    const totalTokens = aggregateTokens(results.map((r) => r.totalTokens));
    const timestamp = new Date().toISOString();

    return {
      totalRuns,
      successfulRuns,
      failedRuns,
      totalDurationMs,
      totalCostUSD,
      totalTokens,
      results,
      timestamp,
    };
  }

  private async executeCell(
    cell: MatrixCellDescriptor,
    config: MatrixExecutionConfig,
    collectorFactory?: (cell: MatrixCellDescriptor) => StreamCollector
  ): Promise<ScenarioResult> {
    const runId = `matrix-${cell.scenarioId}-${cell.modelId}-r${cell.repetitionIndex}-${randomUUID().slice(0, 8)}`;
    const cellStartedAt = new Date().toISOString();
    const cellStartTime = performance.now();

    this.options?.onCellStart?.(cell, runId);

    let container: IContainerInstance | undefined;
    let result: ScenarioResult;

    try {
      if (config.containerPool) {
        const launchConfig: ContainerLaunchConfig = {
          runId,
          scenarioId: cell.scenarioId,
          imageTag: "skill-benchmarks-runtime:latest",
          resourceLimits: {
            cpus: 2,
            memoryMb: 4096,
            pidsLimit: 256,
          },
          networkMode: "sb-bridge-isolated",
          workspaceVolumeName: `sb-vol-${runId.replace(/[^a-zA-Z0-9_.-]/g, "-")}`,
          artifactHostPath: `${config.workspaceRoot}/${runId}`,
          timeouts: {
            commandTimeoutMs: config.limits.toolTimeoutMs,
            turnTimeoutMs: config.limits.toolTimeoutMs,
            totalScenarioTimeoutMs: config.limits.maxWallClockTimeMs,
          },
        };
        container = await config.containerPool.acquire(launchConfig);
      }

      const runConfig: ScenarioRunConfig = {
        runId,
        scenarioId: cell.scenarioId,
        skillIds: cell.skillIds,
        modelId: cell.modelId,
        provider: cell.provider,
        prompt: cell.scenarioId,
        container,
        limits: config.limits,
        temperature: config.temperature,
        thinkingLevel: cell.thinkingLevel,
      };

      const collector = collectorFactory ? collectorFactory(cell) : undefined;
      result = await this.runnerEngine.run(runConfig, collector);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const totalDurationMs =
        Math.round((performance.now() - cellStartTime) * 100) / 100;

      result = {
        runId,
        scenarioId: cell.scenarioId,
        skillIds: cell.skillIds,
        modelId: cell.modelId,
        executionMode: cell.provider.executionMode ?? "live",
        simulated: cell.provider.executionMode === "fake",
        terminationReason: "error",
        completed: false,
        turns: 0,
        turnHistory: [],
        toolHistory: [],
        messages: [],
        finalOutput: "",
        totalDurationMs,
        totalTokens: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          totalTokens: 0,
        },
        totalCostUSD: 0,
        consecutiveToolErrors: 0,
        startedAt: cellStartedAt,
        finishedAt: new Date().toISOString(),
        errorMessage,
      };
    } finally {
      if (config.containerPool && container) {
        try {
          await config.containerPool.release(container);
        } catch {
        }
      }
    }

    this.options?.onCellComplete?.(cell, result);
    return result;
  }
}

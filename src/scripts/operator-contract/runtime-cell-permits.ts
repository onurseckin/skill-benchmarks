import type { IContainerPoolManager } from "../../infrastructure/container/types.js";
import { TelemetryDatabase } from "../../reporting/db.js";
import { ScenarioRunnerEngine } from "../../runner/runner-engine.js";
import { ScenarioLoader } from "../../runner/scenario-loader.js";
import { executeSweepCell } from "../../sweep/cell-execution.js";
import { TokenBucketRateLimiter } from "../../sweep/token-bucket.js";
import type {
  MatrixCellDescriptor,
  MatrixSweepConfig,
  ModelMatrixEntry,
} from "../../sweep/types.js";
import { requireCondition } from "./assertions.js";

export async function verifyCellPermitFinalization(temporaryRoot: string): Promise<void> {
  const limiter = new TokenBucketRateLimiter("openai", {
    maxRequestsPerMinute: 100,
    maxTokensPerMinute: 10_000,
    maxConcurrentRequests: 1,
    jitter: false,
  });
  const database = new TelemetryDatabase(":memory:");
  try {
    const cell = createCell(temporaryRoot);
    const result = await executeSweepCell({
      cell,
      config: createConfig(temporaryRoot, cell.modelEntry),
      scenarioLoader: new ScenarioLoader(),
      runnerEngine: new ScenarioRunnerEngine(),
      telemetryDb: database,
      limiter,
      signal: new AbortController().signal,
      planFingerprint: "fixture-plan-fingerprint",
    });
    requireCondition(result.executionCompleted === false, "cell_setup_failure_terminal_status");
    requireCondition(result.attemptCount === 1, "cell_setup_failure_attempt_count");
    requireCondition(limiter.getStatus().activePermits === 0, "cell_setup_failure_permit_leak");
  } finally {
    database.close();
  }
}

function createCell(outputRoot: string): MatrixCellDescriptor {
  const modelEntry: ModelMatrixEntry = {
    modelId: "gpt-4o",
    providerId: "openai",
  };
  return {
    sweepId: "fixture-sweep",
    cellId: "fixture-cell",
    matrixOccurrenceIndex: 0,
    runId: "fixture-run",
    scenarioId: "git-worktrees",
    skillId: "tdd",
    modelId: "gpt-4o",
    providerId: "openai",
    thinkingLevel: undefined,
    thinkingBudget: undefined,
    repetitionIndex: 0,
    executionMode: "fake",
    outputRoot,
    modelEntry,
    limits: {
      maxTurns: 1,
      maxWallClockTimeMs: 500,
      maxCostUSD: 1,
      maxConsecutiveToolFailures: 1,
      toolTimeoutMs: 100,
      maxOutputSizeBytes: 1024,
    },
  } as MatrixCellDescriptor;
}

function createConfig(
  outputRoot: string,
  modelEntry: ModelMatrixEntry,
): MatrixSweepConfig {
  const containerPool: IContainerPoolManager = {
    activeCount: 0,
    queuedCount: 0,
    maxConcurrency: 1,
    async acquire() {
      throw new Error("fixture setup failure");
    },
    async release() {},
    async drain() {},
  };
  return {
    runtimeConfig: { executionMode: "fake", outputRoot },
    scenarioIds: ["git-worktrees"],
    skillIds: ["tdd"],
    models: [modelEntry],
    dryRun: true,
    maxRetriesPerCell: 0,
    containerPool,
  };
}

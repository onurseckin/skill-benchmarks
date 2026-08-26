import type {
  IContainerInstance,
  IContainerPoolManager,
} from "../../infrastructure/container/types.js";
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
import { createLaunchConfig } from "./container-lifecycle-fixtures.js";

export async function verifyPostAcquireAbort(temporaryRoot: string): Promise<void> {
  const controller = new AbortController();
  const container = createFixtureContainer();
  let receivedSignal: AbortSignal | undefined;
  let releaseCount = 0;
  const containerPool: IContainerPoolManager = {
    activeCount: 1,
    queuedCount: 0,
    maxConcurrency: 1,
    getStatus() {
      return {
        accepting: true,
        queuedCount: 0,
        creatingCount: 0,
        activeCount: 1,
        releasingCount: 0,
        cleanupFailedCount: 0,
      };
    },
    async acquire(_config, signal) {
      receivedSignal = signal;
      controller.abort(new Error("post acquire abort"));
      return container;
    },
    async release(instance) {
      requireCondition(instance === container, "container_post_acquire_releases_received_lease");
      releaseCount += 1;
    },
    async drain() {},
  };
  const database = new TelemetryDatabase(":memory:");
  try {
    const modelEntry: ModelMatrixEntry = { modelId: "gpt-4o", providerId: "openai" };
    const result = await executeSweepCell({
      cell: createSweepCell(temporaryRoot, modelEntry),
      config: createSweepConfig(temporaryRoot, modelEntry, containerPool),
      scenarioLoader: new ScenarioLoader(),
      runnerEngine: new ScenarioRunnerEngine(),
      telemetryDb: database,
      limiter: new TokenBucketRateLimiter("openai", {
        maxRequestsPerMinute: 10,
        maxTokensPerMinute: 1000,
        maxConcurrentRequests: 1,
        jitter: false,
      }),
      signal: controller.signal,
      planFingerprint: "container-lifecycle-fixture",
    });
    requireCondition(
      receivedSignal === controller.signal,
      "container_post_acquire_forwards_signal",
    );
    requireCondition(releaseCount === 1, "container_post_acquire_releases_once");
    requireCondition(result.status === "aborted", "container_post_acquire_prevents_runner");
  } finally {
    database.close();
  }
}

function createFixtureContainer(): IContainerInstance {
  const config = createLaunchConfig();
  return {
    containerId: "post-acquire-container",
    runId: config.runId,
    state: "READY",
    config,
    async executeCommand() {
      throw new Error("runner dispatch must not reach container");
    },
    async readFile() {
      throw new Error("runner dispatch must not reach container");
    },
    async writeFile() {
      throw new Error("runner dispatch must not reach container");
    },
    async extractGitDiff() {
      throw new Error("runner dispatch must not reach container");
    },
    async teardown() {},
  };
}

export function createSweepCell(
  outputRoot: string,
  modelEntry: ModelMatrixEntry,
): MatrixCellDescriptor {
  return {
    sweepId: "container-lifecycle-sweep",
    cellId: "container-lifecycle-cell",
    matrixOccurrenceIndex: 0,
    runId: "container-lifecycle-run",
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

export function createSweepConfig(
  outputRoot: string,
  modelEntry: ModelMatrixEntry,
  containerPool: IContainerPoolManager,
  dryRun = true,
): MatrixSweepConfig {
  return {
    runtimeConfig: { executionMode: "fake", outputRoot },
    scenarioIds: ["git-worktrees"],
    skillIds: ["tdd"],
    models: [modelEntry],
    dryRun,
    maxRetriesPerCell: 0,
    containerPool,
  };
}

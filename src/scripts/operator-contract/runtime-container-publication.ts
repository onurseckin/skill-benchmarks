import { ContainerPoolManager } from "../../infrastructure/container/pool.js";
import { TelemetryDatabase } from "../../reporting/db.js";
import { ScenarioRunnerEngine } from "../../runner/runner-engine.js";
import type { ScenarioResult, ScenarioRunConfig } from "../../runner/types.js";
import { ScenarioLoader } from "../../runner/scenario-loader.js";
import { executeSweepCell } from "../../sweep/cell-execution.js";
import { TokenBucketRateLimiter } from "../../sweep/token-bucket.js";
import type { ModelMatrixEntry } from "../../sweep/types.js";
import { requireCondition } from "./assertions.js";
import { assertPending, FakeDockerClient } from "./container-lifecycle-fixtures.js";
import { createSweepCell, createSweepConfig } from "./runtime-container-post-acquire.js";

class DispatchTrackingRunner extends ScenarioRunnerEngine {
  public dispatchCount = 0;

  public override async run(_config: ScenarioRunConfig): Promise<ScenarioResult> {
    this.dispatchCount += 1;
    throw new Error("provider dispatch must not begin after publication-boundary abort");
  }
}

export async function verifyPoolPublicationBoundary(temporaryRoot: string): Promise<void> {
  const dockerClient = new FakeDockerClient();
  dockerClient.hold("start-container");
  const controller = new AbortController();
  dockerClient.afterPhase("start-container", () => {
    controller.abort(new Error("publication-boundary abort"));
  });
  const pool = new ContainerPoolManager({
    maxConcurrency: 1,
    startupJitterMs: 0,
    dockerClient,
  });
  const database = new TelemetryDatabase(":memory:");
  const runner = new DispatchTrackingRunner();
  const modelEntry: ModelMatrixEntry = { modelId: "gpt-4o", providerId: "openai" };
  const cell = {
    ...createSweepCell(temporaryRoot, modelEntry),
    cellId: "container-publication-cell",
    runId: "container-publication-run",
  };
  try {
    const execution = executeSweepCell({
      cell,
      config: createSweepConfig(temporaryRoot, modelEntry, pool, false),
      scenarioLoader: new ScenarioLoader(),
      runnerEngine: runner,
      telemetryDb: database,
      limiter: new TokenBucketRateLimiter("openai", {
        maxRequestsPerMinute: 10,
        maxTokensPerMinute: 1000,
        maxConcurrentRequests: 1,
        jitter: false,
      }),
      signal: controller.signal,
      planFingerprint: "container-publication-boundary-fixture",
    });
    await waitForPoolCall(dockerClient, "start-container:");
    const pendingStatus = pool.getStatus();
    requireCondition(pendingStatus.creatingCount === 1, "publication_abort_has_pending_lease");
    requireCondition(pendingStatus.activeCount === 0, "publication_abort_has_no_published_lease");
    await assertPending(execution, "publication_abort_waits_for_pending_lease");
    dockerClient.release("start-container");
    const result = await execution;
    requireCondition(result.status === "aborted", "publication_abort_terminal_status");
    requireCondition(runner.dispatchCount === 0, "publication_abort_prevents_provider_dispatch");
    requireCondition(pool.activeCount === 0, "publication_abort_has_no_active_lease");
    requireCondition(
      pool.getStatus().creatingCount === 0,
      "publication_abort_settles_creation_lease",
    );
    requireCondition(dockerClient.resourceCount === 0, "publication_abort_cleans_owned_resources");
  } finally {
    database.close();
  }
}

async function waitForPoolCall(dockerClient: FakeDockerClient, prefix: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (dockerClient.hasCall(prefix)) return;
    await Bun.sleep(1);
  }
  throw new Error(`Timed out waiting for fake Docker call '${prefix}'`);
}

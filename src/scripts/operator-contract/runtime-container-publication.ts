import { ContainerPoolManager } from "../../infrastructure/container/pool.js";
import { TelemetryDatabase } from "../../reporting/db.js";
import { ScenarioRunnerEngine } from "../../runner/runner-engine.js";
import type { ScenarioResult, ScenarioRunConfig } from "../../runner/types.js";
import { ScenarioLoader } from "../../runner/scenario-loader.js";
import { executeSweepCell } from "../../sweep/cell-execution.js";
import { TokenBucketRateLimiter } from "../../sweep/token-bucket.js";
import type { ModelMatrixEntry } from "../../sweep/types.js";
import { requireCondition } from "./assertions.js";
import { assertPending, expectFailure, FakeDockerClient } from "./container-lifecycle-fixtures.js";
import { FixturePhaseDeadline } from "./fixture-phase-deadline.js";
import { createSweepCell, createSweepConfig } from "./runtime-container-post-acquire.js";

class DispatchTrackingRunner extends ScenarioRunnerEngine {
  public dispatchCount = 0;

  public override async run(_config: ScenarioRunConfig): Promise<ScenarioResult> {
    this.dispatchCount += 1;
    throw new Error("provider dispatch must not begin after publication-boundary abort");
  }
}

export async function verifyPoolPublicationBoundary(temporaryRoot: string): Promise<void> {
  await verifyPhaseWaitDeadline();
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
    const phaseDeadline = new FixturePhaseDeadline(1000);
    try {
      await dockerClient.waitForPhase("start-container", phaseDeadline.signal);
      requireCondition(
        dockerClient.phaseDeadlineListenerCount === 0,
        "publication_abort_phase_wait_clears_listener",
      );
    } finally {
      phaseDeadline.dispose();
    }
    requireCondition(!phaseDeadline.active, "publication_abort_phase_wait_clears_timer");
    const pendingStatus = pool.getStatus();
    requireCondition(pendingStatus.creatingCount === 1, "publication_abort_has_pending_lease");
    requireCondition(pendingStatus.activeCount === 0, "publication_abort_has_no_published_lease");
    await assertPending(execution, "publication_abort_waits_for_pending_lease");
    dockerClient.release("start-container");
    const result = await execution;
    requireEmptyPool(pool, dockerClient, true, "publication_abort_pre_drain");
    requireCondition(result.status === "aborted", "publication_abort_terminal_status");
    requireCondition(runner.dispatchCount === 0, "publication_abort_prevents_provider_dispatch");
    await pool.drain();
    requireEmptyPool(pool, dockerClient, false, "publication_abort_post_drain");
  } finally {
    database.close();
  }
}

async function verifyPhaseWaitDeadline(): Promise<void> {
  const dockerClient = new FakeDockerClient();
  const deadline = new FixturePhaseDeadline(0);
  try {
    await expectFailure(
      dockerClient.waitForPhase("start-container", deadline.signal),
      "FixturePhaseTimeoutError",
    );
    requireCondition(
      dockerClient.phaseDeadlineListenerCount === 0,
      "phase_deadline_timeout_clears_listener",
    );
  } finally {
    deadline.dispose();
  }
  requireCondition(!deadline.active, "phase_deadline_timeout_clears_timer");
}

function requireEmptyPool(
  pool: ContainerPoolManager,
  dockerClient: FakeDockerClient,
  accepting: boolean,
  label: string,
): void {
  const status = pool.getStatus();
  requireCondition(status.accepting === accepting, `${label}_accepting`);
  requireCondition(status.queuedCount === 0, `${label}_queue`);
  requireCondition(status.creatingCount === 0, `${label}_creation`);
  requireCondition(status.activeCount === 0, `${label}_active`);
  requireCondition(status.releasingCount === 0, `${label}_release`);
  requireCondition(status.cleanupFailedCount === 0, `${label}_cleanup_failure`);
  requireCondition(dockerClient.resourceCount === 0, `${label}_resources`);
}

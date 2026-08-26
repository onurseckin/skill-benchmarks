import { ContainerPoolManager } from "../../infrastructure/container/pool.js";
import { requireCondition } from "./assertions.js";
import {
  assertPending,
  createLaunchConfig,
  expectFailure,
  FakeDockerClient,
  ManualQueueTimer,
  waitForCall,
} from "./container-lifecycle-fixtures.js";
import { verifyPostAcquireAbort } from "./runtime-container-post-acquire.js";

export async function verifyContainerLifecycle(temporaryRoot: string): Promise<void> {
  await verifyPreAbortedAcquire();
  await verifyDrainDuringStartupJitter();
  await verifyDrainDuringVolumeCreation();
  await verifyLateUnknownContainerCreationCleanup();
  await verifyDrainDuringContainerStart();
  await verifyCallerAbortDuringContainerStart();
  await verifyCreationFailures();
  await verifyCreationCleanupFailureRetry();
  await verifyQueueCancellationAndTimeout();
  await verifyQueueDrain();
  await verifyRepeatedReleaseAndDrain();
  await verifyCleanupFailureRetry();
  await verifyTwentyCycleStability();
  await verifyPostAcquireAbort(temporaryRoot);
}

async function verifyPreAbortedAcquire(): Promise<void> {
  const dockerClient = new FakeDockerClient();
  const pool = createPool(dockerClient);
  const controller = new AbortController();
  controller.abort(new Error("fixture abort"));
  await expectFailure(
    pool.acquire(createLaunchConfig(), controller.signal),
    "ExecutionAbortedError",
  );
  requireCondition(dockerClient.calls.length === 0, "container_preabort_has_no_docker_calls");
  requireZero(pool, dockerClient, "container_preabort_zero_ownership");
}

async function verifyDrainDuringStartupJitter(): Promise<void> {
  const dockerClient = new FakeDockerClient();
  let releaseJitter: (() => void) | undefined;
  const jitterPromise = new Promise<void>((resolve) => {
    releaseJitter = resolve;
  });
  const pool = createPool(dockerClient, {
    waitForStartupJitter: async () => await jitterPromise,
  });
  const acquisition = pool.acquire(createLaunchConfig());
  void acquisition.catch(() => {});
  await Promise.resolve();
  const drain = pool.drain();
  await assertPending(drain, "drain_during_startup_jitter");
  releaseJitter?.();
  await expectFailure(acquisition, "DrainInitiatedError");
  await drain;
  requireCondition(dockerClient.calls.length === 0, "container_jitter_prevents_docker_creation");
  requireZero(pool, dockerClient, "container_jitter_zero_ownership");
}

async function verifyDrainDuringVolumeCreation(): Promise<void> {
  const dockerClient = new FakeDockerClient();
  dockerClient.hold("create-volume");
  const pool = createPool(dockerClient);
  const acquisition = pool.acquire(createLaunchConfig());
  void acquisition.catch(() => {});
  await waitForCall(dockerClient, "create-volume:");
  const drain = pool.drain();
  await assertPending(drain, "drain_during_volume_creation");
  dockerClient.release("create-volume");
  await expectFailure(acquisition, "DrainInitiatedError");
  await drain;
  requireCondition(
    dockerClient.callCount("create-container") === 0,
    "volume_abort_blocks_container",
  );
  requireCondition(
    dockerClient.callCount("remove-volume") === 1,
    "volume_abort_removes_volume_once",
  );
  requireZero(pool, dockerClient, "volume_abort_zero_ownership");
}

async function verifyLateUnknownContainerCreationCleanup(): Promise<void> {
  const dockerClient = new FakeDockerClient();
  dockerClient.hold("create-container");
  const pool = createPool(dockerClient);
  const config = createLaunchConfig();
  const acquisition = pool.acquire(config);
  void acquisition.catch(() => {});
  await waitForCall(dockerClient, "create-container:");
  const drain = pool.drain();
  await assertPending(drain, "drain_during_container_creation");
  dockerClient.release("create-container");
  await expectFailure(acquisition, "DrainInitiatedError");
  await drain;
  requireCondition(dockerClient.callCount("start-container") === 0, "container_abort_blocks_start");
  requireCondition(
    dockerClient.hasCall(`remove-container:sb-run-${config.runId}`),
    "container_unknown_id_uses_deterministic_name",
  );
  requireZero(pool, dockerClient, "container_creation_zero_ownership");
}

async function verifyDrainDuringContainerStart(): Promise<void> {
  const dockerClient = new FakeDockerClient();
  dockerClient.hold("start-container");
  const pool = createPool(dockerClient);
  const acquisition = pool.acquire(createLaunchConfig());
  void acquisition.catch(() => {});
  await waitForCall(dockerClient, "start-container:");
  const drain = pool.drain();
  await assertPending(drain, "drain_during_container_start");
  dockerClient.release("start-container");
  await expectFailure(acquisition, "DrainInitiatedError");
  await drain;
  requireCondition(
    dockerClient.callCount("remove-container") === 1,
    "start_abort_removes_container_once",
  );
  requireCondition(
    dockerClient.callCount("remove-volume") === 1,
    "start_abort_removes_volume_once",
  );
  requireZero(pool, dockerClient, "container_start_zero_ownership");
}

async function verifyCallerAbortDuringContainerStart(): Promise<void> {
  const dockerClient = new FakeDockerClient();
  dockerClient.hold("start-container");
  const pool = createPool(dockerClient);
  const controller = new AbortController();
  const acquisition = pool.acquire(createLaunchConfig(), controller.signal);
  void acquisition.catch(() => {});
  await waitForCall(dockerClient, "start-container:");
  controller.abort(new Error("caller cancellation"));
  await assertPending(acquisition, "caller_abort_waits_for_docker_settlement");
  dockerClient.release("start-container");
  await expectFailure(acquisition, "ExecutionAbortedError");
  requireCondition(pool.getStatus().accepting, "caller_abort_keeps_pool_accepting");
  requireZero(pool, dockerClient, "caller_abort_zero_ownership");
  const laterInstance = await pool.acquire(createLaunchConfig());
  await pool.release(laterInstance);
  await pool.drain();
  requireZero(pool, dockerClient, "caller_abort_later_acquire_zero_ownership");
}

async function verifyCreationFailures(): Promise<void> {
  const createFailureDocker = new FakeDockerClient();
  createFailureDocker.failNext("create-container");
  const createFailurePool = createPool(createFailureDocker);
  await expectFailure(createFailurePool.acquire(createLaunchConfig()));
  requireCondition(
    createFailureDocker.callCount("remove-volume") === 1,
    "container_create_failure_removes_volume",
  );
  requireZero(createFailurePool, createFailureDocker, "container_create_failure_zero_ownership");

  const startFailureDocker = new FakeDockerClient();
  startFailureDocker.failNext("start-container");
  const startFailurePool = createPool(startFailureDocker);
  await expectFailure(startFailurePool.acquire(createLaunchConfig()));
  requireCondition(
    startFailureDocker.callCount("remove-container") === 1,
    "container_start_failure_removes_container",
  );
  requireCondition(
    startFailureDocker.callCount("remove-volume") === 1,
    "container_start_failure_removes_volume",
  );
  requireZero(startFailurePool, startFailureDocker, "container_start_failure_zero_ownership");
}

async function verifyCreationCleanupFailureRetry(): Promise<void> {
  const dockerClient = new FakeDockerClient();
  dockerClient.hold("create-container");
  dockerClient.failNext("remove-container");
  const pool = createPool(dockerClient);
  const acquisition = pool.acquire(createLaunchConfig());
  void acquisition.catch(() => {});
  await waitForCall(dockerClient, "create-container:");
  const drain = pool.drain();
  dockerClient.release("create-container");
  await expectFailure(acquisition, "ContainerCleanupError");
  await expectFailure(drain, "ContainerDrainError");
  const failedStatus = pool.getStatus();
  requireCondition(failedStatus.creatingCount === 0, "creation_cleanup_failure_not_creating");
  requireCondition(
    failedStatus.cleanupFailedCount === 1,
    "creation_cleanup_failure_reports_residual_ownership",
  );
  requireCondition(
    dockerClient.resourceCount === 1,
    "creation_cleanup_failure_keeps_resource_visible",
  );
  await pool.drain();
  requireCondition(
    dockerClient.callCount("remove-container") === 2,
    "creation_cleanup_retry_retries_deterministic_container",
  );
  requireCondition(
    dockerClient.callCount("remove-volume") === 1,
    "creation_cleanup_retry_does_not_repeat_completed_volume",
  );
  requireZero(pool, dockerClient, "creation_cleanup_retry_zero_ownership");
}

async function verifyQueueCancellationAndTimeout(): Promise<void> {
  const dockerClient = new FakeDockerClient();
  const timer = new ManualQueueTimer();
  const pool = createPool(dockerClient, { queueTimer: timer });
  const active = await pool.acquire(createLaunchConfig());
  const controller = new AbortController();
  const cancelled = pool.acquire(createLaunchConfig(), controller.signal);
  controller.abort(new Error("queue cancelled"));
  await expectFailure(cancelled, "ExecutionAbortedError");
  requireCondition(pool.queuedCount === 0, "container_cancelled_queue_removed");
  const timedOut = pool.acquire(createLaunchConfig());
  timer.fireAll();
  await expectFailure(timedOut, "QueueTimeoutError");
  requireCondition(timer.activeCount === 0, "container_queue_timeout_clears_timer");
  await pool.release(active);
  await pool.drain();
  requireZero(pool, dockerClient, "container_queue_cancel_timeout_zero_ownership");
}

async function verifyQueueDrain(): Promise<void> {
  const dockerClient = new FakeDockerClient();
  const pool = createPool(dockerClient);
  await pool.acquire(createLaunchConfig());
  const queuedFirst = pool.acquire(createLaunchConfig());
  const queuedSecond = pool.acquire(createLaunchConfig());
  void queuedFirst.catch(() => {});
  void queuedSecond.catch(() => {});
  const drain = pool.drain();
  await expectFailure(queuedFirst, "DrainInitiatedError");
  await expectFailure(queuedSecond, "DrainInitiatedError");
  await drain;
  requireZero(pool, dockerClient, "container_queue_drain_zero_ownership");
}

async function verifyRepeatedReleaseAndDrain(): Promise<void> {
  const dockerClient = new FakeDockerClient();
  dockerClient.hold("remove-container");
  const pool = createPool(dockerClient);
  const instance = await pool.acquire(createLaunchConfig());
  const firstRelease = pool.release(instance);
  const secondRelease = pool.release(instance);
  requireCondition(firstRelease === secondRelease, "container_repeated_release_joins_attempt");
  await waitForCall(dockerClient, "remove-container:");
  const firstDrain = pool.drain();
  const secondDrain = pool.drain();
  requireCondition(firstDrain === secondDrain, "container_repeated_drain_joins_attempt");
  await assertPending(firstDrain, "drain_during_release");
  dockerClient.release("remove-container");
  await Promise.all([firstRelease, firstDrain]);
  requireCondition(
    dockerClient.callCount("remove-container") === 1,
    "container_release_removes_once",
  );
  requireCondition(dockerClient.callCount("remove-volume") === 1, "container_release_volume_once");
  requireZero(pool, dockerClient, "container_repeated_release_zero_ownership");
}

async function verifyCleanupFailureRetry(): Promise<void> {
  const dockerClient = new FakeDockerClient();
  dockerClient.failNext("remove-container");
  const pool = createPool(dockerClient);
  await pool.acquire(createLaunchConfig());
  await expectFailure(pool.drain(), "ContainerDrainError");
  const failedStatus = pool.getStatus();
  requireCondition(failedStatus.activeCount === 1, "container_failed_drain_retains_active_lease");
  requireCondition(failedStatus.cleanupFailedCount === 1, "container_failed_drain_reports_failure");
  await pool.drain();
  requireCondition(
    dockerClient.callCount("remove-container") === 2,
    "container_retry_retries_container_only",
  );
  requireCondition(
    dockerClient.callCount("remove-volume") === 1,
    "container_retry_preserves_volume_proof",
  );
  requireZero(pool, dockerClient, "container_cleanup_retry_zero_ownership");
}

async function verifyTwentyCycleStability(): Promise<void> {
  const dockerClient = new FakeDockerClient();
  const pool = createPool(dockerClient);
  for (let cycle = 0; cycle < 20; cycle += 1) {
    const instance = await pool.acquire(createLaunchConfig());
    await pool.release(instance);
  }
  await pool.drain();
  requireZero(pool, dockerClient, "container_twenty_cycle_zero_ownership");
}

function createPool(
  dockerClient: FakeDockerClient,
  overrides: ConstructorParameters<typeof ContainerPoolManager>[0] = {},
): ContainerPoolManager {
  return new ContainerPoolManager({
    maxConcurrency: 1,
    startupJitterMs: 0,
    dockerClient,
    ...overrides,
  });
}

function requireZero(
  pool: ContainerPoolManager,
  dockerClient: FakeDockerClient,
  label: string,
): void {
  const status = pool.getStatus();
  requireCondition(status.queuedCount === 0, `${label}_queue`);
  requireCondition(status.creatingCount === 0, `${label}_creating`);
  requireCondition(status.activeCount === 0, `${label}_active`);
  requireCondition(status.releasingCount === 0, `${label}_releasing`);
  requireCondition(status.cleanupFailedCount === 0, `${label}_cleanup_failure`);
  requireCondition(dockerClient.resourceCount === 0, `${label}_fake_resources`);
}

import { ContainerPoolManager } from "../../infrastructure/container/pool.js";
import { requireCondition } from "./assertions.js";
import {
  createLaunchConfig,
  expectFailure,
  FakeDockerClient,
} from "./container-lifecycle-fixtures.js";

export async function verifyContainerOwnership(): Promise<void> {
  await verifyConcurrentIdenticalRunOwnership();
  await verifyNameConflictPreservesUnownedContainer();
}

async function verifyConcurrentIdenticalRunOwnership(): Promise<void> {
  const dockerClient = new FakeDockerClient();
  const pool = createPool(dockerClient, 2);
  const config = createLaunchConfig();
  const [first, second] = await Promise.all([pool.acquire(config), pool.acquire(config)]);
  requireCondition(
    first.config.workspaceVolumeName !== second.config.workspaceVolumeName,
    "identical_run_leases_use_distinct_volume_names",
  );
  requireCondition(
    new Set(dockerClient.calls.filter((call) => call.startsWith("create-container:"))).size === 2,
    "identical_run_leases_use_distinct_container_names",
  );
  const initialResourceCount = dockerClient.resourceCount;
  requireCondition(initialResourceCount === 4, "identical_run_leases_own_four_resources");
  await pool.release(first);
  const afterFirstReleaseResourceCount = dockerClient.resourceCount;
  requireCondition(
    afterFirstReleaseResourceCount === 2,
    "first_identical_run_release_preserves_second_resources",
  );
  await pool.release(second);
  await pool.drain();
  requireZero(pool, dockerClient, "identical_run_leases_zero_ownership");
}

async function verifyNameConflictPreservesUnownedContainer(): Promise<void> {
  const dockerClient = new FakeDockerClient();
  dockerClient.conflictNextContainer();
  const pool = createPool(dockerClient, 1);
  const config = createLaunchConfig();
  await expectFailure(pool.acquire(config), "DockerError");
  requireCondition(
    dockerClient.containers.size === 1,
    "container_conflict_preserves_external_container",
  );
  requireCondition(dockerClient.volumes.size === 0, "container_conflict_removes_owned_volume");
  const [externalContainerName] = dockerClient.containers;
  requireCondition(
    externalContainerName !== undefined,
    "container_conflict_external_container_exists",
  );
  const externalContainer = await dockerClient.inspectContainer(externalContainerName);
  requireCondition(
    externalContainer.config.labels["io.skill-benchmarks.managed"] === "true",
    "container_conflict_external_managed_label_matches_request",
  );
  requireCondition(
    externalContainer.config.labels["io.skill-benchmarks.run-id"] === config.runId,
    "container_conflict_external_run_label_matches_request",
  );
  requireCondition(
    externalContainer.config.labels["io.skill-benchmarks.scenario-id"] === config.scenarioId,
    "container_conflict_external_scenario_label_matches_request",
  );
  requireCondition(
    externalContainer.config.labels["io.skill-benchmarks.lease-id"] === "external-lease-uuid",
    "container_conflict_external_lease_label_differs",
  );
  requireCondition(
    dockerClient.callCount("remove-container") === 0,
    "container_conflict_never_removes_unowned_container",
  );
  requirePoolNoResidual(pool, "container_conflict_pool_has_no_owned_residuals");
  await pool.drain();
  requireCondition(
    dockerClient.containers.size === 1,
    "container_conflict_drain_preserves_external_container",
  );
}

function createPool(dockerClient: FakeDockerClient, maxConcurrency: number): ContainerPoolManager {
  return new ContainerPoolManager({ maxConcurrency, startupJitterMs: 0, dockerClient });
}

function requireZero(
  pool: ContainerPoolManager,
  dockerClient: FakeDockerClient,
  label: string,
): void {
  requirePoolNoResidual(pool, label);
  requireCondition(dockerClient.resourceCount === 0, `${label}_fake_resources`);
}

function requirePoolNoResidual(pool: ContainerPoolManager, label: string): void {
  const status = pool.getStatus();
  requireCondition(status.queuedCount === 0, `${label}_queue`);
  requireCondition(status.creatingCount === 0, `${label}_creating`);
  requireCondition(status.activeCount === 0, `${label}_active`);
  requireCondition(status.releasingCount === 0, `${label}_releasing`);
  requireCondition(status.cleanupFailedCount === 0, `${label}_cleanup_failure`);
}

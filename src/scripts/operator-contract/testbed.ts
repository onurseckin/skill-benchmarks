import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import { requireCondition } from "./assertions.js";
import { runCommand, runSuccessfulCommand, startCommand, terminateCommand } from "./command.js";
import { copyTestbedFixture, createNoKeyEnvironment } from "./fixture.js";

export async function verifyTestbedLocalLifecycle(temporaryRoot: string): Promise<void> {
  const testbed = copyTestbedFixture(temporaryRoot);
  const environment = createNoKeyEnvironment(temporaryRoot);
  await runSuccessfulCommand(
    ["bun", "install", "--frozen-lockfile"],
    { cwd: testbed, env: environment, timeoutMs: 120_000 },
    "testbed_install_failed",
  );
  await runSuccessfulCommand(
    ["bun", "run", "typecheck"],
    { cwd: testbed, env: environment, timeoutMs: 120_000 },
    "testbed_typecheck_failed",
  );
  await runSuccessfulCommand(
    ["bun", "run", "build"],
    { cwd: testbed, env: environment, timeoutMs: 120_000 },
    "testbed_build_failed",
  );
  await runSuccessfulCommand(
    ["go", "test", "./..."],
    { cwd: join(testbed, "microservice"), env: environment, timeoutMs: 120_000 },
    "testbed_go_failed",
  );
  const frontendPort = await reservePort();
  const backendPort = await reservePort();
  const running = startCommand(["bun", "run", "start"], {
    cwd: testbed,
    env: createNoKeyEnvironment(temporaryRoot, {
      FRONTEND_HOST: "127.0.0.1",
      FRONTEND_PORT: String(frontendPort),
      BACKEND_HOST: "127.0.0.1",
      BACKEND_PORT: String(backendPort),
      READINESS_HOST: "127.0.0.1",
    }),
  });
  let result;
  try {
    await requireJsonEndpoint(`http://127.0.0.1:${frontendPort}/health`, { status: "ok" });
    await requireJsonEndpoint(`http://127.0.0.1:${backendPort}/health`, { status: "ok" });
    await requireJsonEndpoint(`http://127.0.0.1:${backendPort}/api/items`, {
      success: true,
      data: [],
    });
    const page = await fetchWithRetry(`http://127.0.0.1:${frontendPort}/`);
    requireCondition(page.status === 200, "testbed_frontend_page_invalid");
  } finally {
    result = await terminateCommand(running, "SIGTERM", 10_000);
  }
  requireCondition(result.exitCode === 0, `testbed_stop_failed:${result.stderr}`);
  await requireEndpointClosed(`http://127.0.0.1:${frontendPort}/health`);
  await requireEndpointClosed(`http://127.0.0.1:${backendPort}/health`);
}

export async function verifyTestbedDockerLifecycle(temporaryRoot: string): Promise<void> {
  const identifier = randomUUID();
  const image = `skill-benchmarks-testbed-operator:${identifier}`;
  const container = `skill-benchmarks-testbed-operator-${identifier}`;
  const environment = createNoKeyEnvironment(temporaryRoot);
  let primaryFailure: unknown;
  try {
    const testbed = copyTestbedFixture(temporaryRoot);
    await runSuccessfulCommand(
      ["docker", "build", "--tag", image, testbed],
      { cwd: testbed, env: environment, timeoutMs: 300_000 },
      "testbed_docker_build_failed",
    );
    const frontendPort = await reservePort();
    const backendPort = await reservePort();
    await runSuccessfulCommand(
      [
        "docker",
        "run",
        "--detach",
        "--rm",
        "--name",
        container,
        "--publish",
        `127.0.0.1:${frontendPort}:3000`,
        "--publish",
        `127.0.0.1:${backendPort}:4000`,
        image,
      ],
      { cwd: testbed, env: environment, timeoutMs: 60_000 },
      "testbed_docker_run_failed",
    );
    await verifyImageConfiguration(image, environment, testbed);
    await requireJsonEndpoint(`http://127.0.0.1:${frontendPort}/health`, { status: "ok" });
    await requireJsonEndpoint(`http://127.0.0.1:${backendPort}/health`, { status: "ok" });
    await requireJsonEndpoint(`http://127.0.0.1:${backendPort}/api/items`, {
      success: true,
      data: [],
    });
    await runSuccessfulCommand(
      ["docker", "stop", "--time", "10", container],
      { cwd: testbed, env: environment, timeoutMs: 30_000 },
      "testbed_docker_stop_failed",
    );
  } catch (error) {
    primaryFailure = error;
  }
  let cleanupFailure: unknown;
  try {
    await reconcileDockerResources(
      container,
      image,
      temporaryRoot,
      environment,
      primaryFailure !== undefined,
    );
  } catch (error) {
    cleanupFailure = error;
  }
  if (primaryFailure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError(
      [primaryFailure, cleanupFailure],
      "testbed_docker_primary_and_cleanup_failed",
    );
  }
  if (cleanupFailure !== undefined) throw cleanupFailure;
  if (primaryFailure !== undefined) throw primaryFailure;
}

async function reconcileDockerResources(
  container: string,
  image: string,
  cwd: string,
  environment: Readonly<Record<string, string | undefined>>,
  primaryFailed: boolean,
): Promise<void> {
  const startedAt = Date.now();
  const publicationHorizon = startedAt + (primaryFailed ? 60_000 : 0);
  const deadline = startedAt + (primaryFailed ? 70_000 : 30_000);
  const requiredAbsenceMs = 1_000;
  let absentSince: number | undefined;
  let lastFailure: unknown;
  while (Date.now() < deadline) {
    try {
      const timeoutMs = Math.max(100, Math.min(5_000, deadline - Date.now()));
      const containerExists = await dockerResourceExists(
        ["docker", "container", "inspect", container],
        "No such container",
        cwd,
        environment,
        timeoutMs,
      );
      if (containerExists) {
        absentSince = undefined;
        await requireDockerRemoval(
          ["docker", "container", "rm", "--force", container],
          cwd,
          environment,
          timeoutMs,
          "testbed_container_cleanup_failed",
        );
      }
      const imageExists = await dockerResourceExists(
        ["docker", "image", "inspect", image],
        "No such image",
        cwd,
        environment,
        timeoutMs,
      );
      if (imageExists) {
        absentSince = undefined;
        await requireDockerRemoval(
          ["docker", "image", "rm", "--force", image],
          cwd,
          environment,
          timeoutMs,
          "testbed_image_cleanup_failed",
        );
      }
      if (!containerExists && !imageExists) {
        absentSince ??= Date.now();
        if (Date.now() >= publicationHorizon && Date.now() - absentSince >= requiredAbsenceMs)
          return;
      }
      lastFailure = undefined;
    } catch (error) {
      absentSince = undefined;
      lastFailure = error;
    }
    await Bun.sleep(200);
  }
  const detail =
    lastFailure instanceof Error
      ? lastFailure.message
      : typeof lastFailure === "string" ||
          typeof lastFailure === "number" ||
          typeof lastFailure === "bigint" ||
          typeof lastFailure === "boolean" ||
          typeof lastFailure === "symbol"
        ? String(lastFailure)
        : lastFailure === null
          ? "null"
          : lastFailure === undefined
            ? "unknown"
            : "non_error_failure";
  throw new TypeError(`testbed_docker_cleanup_timeout:${detail}`);
}

async function dockerResourceExists(
  argumentsList: readonly string[],
  absentMessage: string,
  cwd: string,
  environment: Readonly<Record<string, string | undefined>>,
  timeoutMs: number,
): Promise<boolean> {
  const result = await runCommand(argumentsList, { cwd, env: environment, timeoutMs });
  if (result.exitCode === 0) return true;
  requireCondition(result.stderr.includes(absentMessage), "testbed_docker_inspect_failed");
  return false;
}

async function requireDockerRemoval(
  argumentsList: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string | undefined>>,
  timeoutMs: number,
  code: string,
): Promise<void> {
  const result = await runCommand(argumentsList, { cwd, env: environment, timeoutMs });
  requireCondition(result.exitCode === 0, `${code}:${result.stderr.trim()}`);
}

async function verifyImageConfiguration(
  image: string,
  environment: Readonly<Record<string, string | undefined>>,
  cwd: string,
): Promise<void> {
  const result = await runSuccessfulCommand(
    ["docker", "image", "inspect", image],
    { cwd, env: environment },
    "testbed_docker_inspect_failed",
  );
  const parsed: unknown = JSON.parse(result.stdout);
  requireCondition(Array.isArray(parsed) && parsed.length === 1, "testbed_image_inspect_invalid");
  const imageRecord = parsed[0] as Record<string, unknown>;
  const config = imageRecord.Config as Record<string, unknown>;
  const ports = config.ExposedPorts as Record<string, unknown>;
  requireCondition(config.User === "bun", "testbed_image_user_invalid");
  requireCondition(
    Object.keys(ports).sort().join(",") === "3000/tcp,4000/tcp",
    "testbed_image_ports_invalid",
  );
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  requireCondition(address !== null && typeof address !== "string", "testbed_port_unavailable");
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
  });
  return address.port;
}

async function requireJsonEndpoint(url: string, expected: Record<string, unknown>): Promise<void> {
  const response = await fetchWithRetry(url);
  requireCondition(response.status === 200, "testbed_endpoint_status_invalid");
  const body: unknown = await response.json();
  requireCondition(
    JSON.stringify(body) === JSON.stringify(expected),
    "testbed_endpoint_body_invalid",
  );
}

async function fetchWithRetry(url: string): Promise<Response> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(1_000) });
    } catch {
      await Bun.sleep(100);
    }
  }
  throw new TypeError(`testbed_endpoint_timeout:${url}`);
}

async function requireEndpointClosed(url: string): Promise<void> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(500) });
    throw new TypeError("testbed_endpoint_survived");
  } catch (error) {
    requireCondition(
      error instanceof Error && error.message !== "testbed_endpoint_survived",
      "testbed_endpoint_survived",
    );
  }
}

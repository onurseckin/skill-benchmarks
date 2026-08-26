import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

interface ManagedChild {
  readonly name: string;
  readonly process: ChildProcess;
  readonly finite: boolean;
}

const artifactRoot = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(artifactRoot, "frontend");
const frontendPort = Number(process.env.FRONTEND_PORT ?? "3000");
const frontendHost = process.env.FRONTEND_HOST ?? "0.0.0.0";
const backendPort = Number(process.env.BACKEND_PORT ?? "4000");
const readinessHost = process.env.READINESS_HOST ?? "127.0.0.1";

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function sendResponse(
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType: string,
): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    connection: "close",
  });
  response.end(body);
}

async function serveFrontendFile(pathname: string, response: ServerResponse): Promise<void> {
  let requestedPath: string;
  try {
    requestedPath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    sendResponse(response, 400, "Bad request", "text/plain; charset=utf-8");
    return;
  }
  const filePath = resolve(frontendRoot, requestedPath.slice(1));
  if (filePath !== frontendRoot && !filePath.startsWith(`${frontendRoot}${sep}`)) {
    sendResponse(response, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }
  try {
    const file = await readFile(filePath);
    sendResponse(
      response,
      200,
      file.toString(),
      contentTypes[extname(filePath)] ?? "application/octet-stream",
    );
  } catch {
    sendResponse(response, 404, "Not found", "text/plain; charset=utf-8");
  }
}

function listen(server: Server, port: number, hostname: string): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    const handleError = (error: Error): void => {
      server.off("listening", handleListening);
      rejectListen(error);
    };
    const handleListening = (): void => {
      server.off("error", handleError);
      resolveListen();
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, hostname);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
}

async function startFrontendServer(): Promise<void> {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendResponse(response, 405, "Method not allowed", "text/plain; charset=utf-8");
      return;
    }
    if (requestUrl.pathname === "/health") {
      sendResponse(
        response,
        200,
        JSON.stringify({ status: "ok" }),
        "application/json; charset=utf-8",
      );
      return;
    }
    void serveFrontendFile(requestUrl.pathname, response);
  });
  await listen(server, frontendPort, frontendHost);
  console.log(`Frontend ready at http://${frontendHost}:${frontendPort}`);
  let stopping = false;
  const stopFrontend = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`Frontend received ${signal}`);
    await close(server);
  };
  process.once("SIGINT", () => {
    void stopFrontend("SIGINT");
  });
  process.once("SIGTERM", () => {
    void stopFrontend("SIGTERM");
  });
}

function spawnChild(
  name: string,
  command: string,
  argumentsList: readonly string[],
  finite: boolean,
): ManagedChild {
  const child = spawn(command, argumentsList, {
    cwd: artifactRoot,
    env: process.env,
    stdio: "inherit",
  });
  return { name, process: child, finite };
}

async function endpointIsReady(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForReadiness(
  endpoints: readonly string[],
  isStopping: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!isStopping() && Date.now() < deadline) {
    const ready = await Promise.all(endpoints.map((endpoint) => endpointIsReady(endpoint)));
    if (ready.every(Boolean)) {
      return;
    }
    await delay(100);
  }
  throw new Error("Services did not become ready within 15 seconds");
}

async function terminateChild(child: ManagedChild, signal: NodeJS.Signals): Promise<void> {
  if (child.process.exitCode !== null || child.process.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolveExit) => {
    child.process.once("exit", () => resolveExit());
  });
  child.process.kill(signal);
  await Promise.race([exited, delay(3_000)]);
  if (child.process.exitCode === null && child.process.signalCode === null) {
    child.process.kill("SIGKILL");
    await exited;
  }
}

async function startSupervisor(): Promise<void> {
  const children = [
    spawnChild(
      "frontend",
      process.execPath,
      [resolve(artifactRoot, "start.js"), "--serve-frontend"],
      false,
    ),
    spawnChild("backend", process.execPath, [resolve(artifactRoot, "backend/index.js")], false),
    spawnChild("microservice", resolve(artifactRoot, "microservice"), [], true),
  ];
  let stopping = false;
  let finishSupervisor: (exitCode: number) => void = () => undefined;
  const finished = new Promise<number>((resolveFinished) => {
    finishSupervisor = resolveFinished;
  });
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (exitCode: number, reason: string, signal: NodeJS.Signals): Promise<void> => {
    if (shutdownPromise !== undefined) {
      return shutdownPromise;
    }
    stopping = true;
    console.log(`Supervisor stopping: ${reason}`);
    shutdownPromise = Promise.all(children.map((child) => terminateChild(child, signal))).then(
      () => {
        finishSupervisor(exitCode);
      },
    );
    return shutdownPromise;
  };
  for (const child of children) {
    child.process.once("error", (error) => {
      void shutdown(1, `${child.name} failed to start: ${error.message}`, "SIGTERM");
    });
    child.process.once("exit", (code, signal) => {
      if (stopping) {
        return;
      }
      if (child.finite && code === 0) {
        console.log(`${child.name} completed successfully`);
        return;
      }
      const outcome = signal === null ? `code ${code ?? 1}` : `signal ${signal}`;
      void shutdown(1, `${child.name} exited unexpectedly with ${outcome}`, "SIGTERM");
    });
  }
  process.once("SIGINT", () => {
    void shutdown(0, "received SIGINT", "SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown(0, "received SIGTERM", "SIGTERM");
  });
  try {
    await waitForReadiness(
      [
        `http://${readinessHost}:${frontendPort}/health`,
        `http://${readinessHost}:${backendPort}/health`,
        `http://${readinessHost}:${backendPort}/api/items`,
      ],
      () => stopping,
    );
    console.log("Testbed ready");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await shutdown(1, message, "SIGTERM");
  }
  process.exitCode = await finished;
}

if (process.argv[2] === "--serve-frontend") {
  await startFrontendServer();
} else {
  await startSupervisor();
}

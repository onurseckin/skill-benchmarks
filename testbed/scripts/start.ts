import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

interface ManagedChild {
  readonly name: string;
  readonly process: ChildProcess;
  readonly finite: boolean;
  readonly terminal: Promise<ChildTerminal>;
  readonly isTerminal: () => boolean;
}

type ChildTerminal =
  | { readonly kind: "error"; readonly error: Error }
  | {
      readonly kind: "closed";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    };

function requestPathname(requestTarget: string | undefined): string | undefined {
  try {
    return new URL(requestTarget ?? "/", "http://localhost").pathname;
  } catch {
    return undefined;
  }
}

function urlHost(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname;
  }
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}

function serviceUrl(hostname: string, port: number, pathname: string): string {
  return `http://${urlHost(hostname)}:${port}${pathname}`;
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
    const pathname = requestPathname(request.url);
    if (pathname === undefined) {
      sendResponse(response, 400, "Bad request", "text/plain; charset=utf-8");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendResponse(response, 405, "Method not allowed", "text/plain; charset=utf-8");
      return;
    }
    if (pathname === "/health") {
      sendResponse(
        response,
        200,
        JSON.stringify({ status: "ok" }),
        "application/json; charset=utf-8",
      );
      return;
    }
    void serveFrontendFile(pathname, response);
  });
  await listen(server, frontendPort, frontendHost);
  console.log(`Frontend ready at ${serviceUrl(frontendHost, frontendPort, "/")}`);
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
  let terminalState = false;
  let settleTerminal: (terminal: ChildTerminal) => void = () => undefined;
  const terminal = new Promise<ChildTerminal>((resolveTerminal) => {
    settleTerminal = (outcome) => {
      if (terminalState) {
        return;
      }
      terminalState = true;
      resolveTerminal(outcome);
    };
  });
  child.once("error", (error) => {
    settleTerminal({ kind: "error", error });
  });
  child.once("exit", (code, signal) => {
    settleTerminal({ kind: "closed", code, signal });
  });
  child.once("close", (code, signal) => {
    settleTerminal({ kind: "closed", code, signal });
  });
  return {
    name,
    process: child,
    finite,
    terminal,
    isTerminal: () => terminalState,
  };
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
  if (child.isTerminal()) {
    return;
  }
  try {
    child.process.kill(signal);
  } catch {
    return;
  }
  await Promise.race([child.terminal, delay(3_000)]);
  if (child.isTerminal()) {
    return;
  }
  try {
    child.process.kill("SIGKILL");
  } catch {
    return;
  }
  await Promise.race([child.terminal, delay(1_000)]);
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
    void child.terminal.then((outcome) => {
      if (stopping) {
        return;
      }
      if (outcome.kind === "error") {
        void shutdown(1, `${child.name} failed to start: ${outcome.error.message}`, "SIGTERM");
        return;
      }
      if (child.finite && outcome.code === 0) {
        console.log(`${child.name} completed successfully`);
        return;
      }
      const description =
        outcome.signal === null ? `code ${outcome.code ?? 1}` : `signal ${outcome.signal}`;
      void shutdown(1, `${child.name} exited unexpectedly with ${description}`, "SIGTERM");
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
        serviceUrl(readinessHost, frontendPort, "/health"),
        serviceUrl(readinessHost, backendPort, "/health"),
        serviceUrl(readinessHost, backendPort, "/api/items"),
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

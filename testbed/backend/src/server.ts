import { createServer, type Server, type ServerResponse } from "node:http";
import { ApiHandler } from "./routes/api.js";

export interface BackendServer {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly handler: ApiHandler;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    connection: "close",
  });
  response.end(JSON.stringify(payload));
}

function requestPathname(requestTarget: string | undefined): string | undefined {
  try {
    return new URL(requestTarget ?? "/", "http://localhost").pathname;
  } catch {
    return undefined;
  }
}

function startListening(server: Server, port: number, hostname: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error): void => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = (): void => {
      server.off("error", handleError);
      resolve();
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, hostname);
  });
}

function stopListening(server: Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function createBackendServer(
  port = Number(process.env.BACKEND_PORT ?? "4000"),
  hostname = process.env.BACKEND_HOST ?? "0.0.0.0",
): BackendServer {
  const handler = new ApiHandler();
  const server = createServer((request, response) => {
    const pathname = requestPathname(request.url);
    if (pathname === undefined) {
      sendJson(response, 400, { success: false, error: "Bad request" });
      return;
    }
    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (request.method === "GET" && pathname === "/api/items") {
      sendJson(response, 200, handler.handleGetItems());
      return;
    }
    sendJson(response, 404, { success: false, error: "Route not found" });
  });

  return {
    start: () => startListening(server, port, hostname),
    stop: () => stopListening(server),
    handler,
  };
}

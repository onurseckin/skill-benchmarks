import { HttpServer } from "./http-server.js";
import type {
  ApiHealthResponse,
  ApiLeaderboardResponse,
  ApiReplayResponse,
  ApiResponse,
  ApiRunsResponse,
  ApiSummaryResponse,
  ApiTrendsResponse,
  HttpServerInstance,
  ServerErrorBody,
  ServerErrorCode,
  ServerOptions,
  ServerState,
} from "./types.js";

export type {
  ApiHealthResponse,
  ApiLeaderboardResponse,
  ApiReplayResponse,
  ApiResponse,
  ApiRunsResponse,
  ApiSummaryResponse,
  ApiTrendsResponse,
  HttpServerInstance,
  ServerErrorBody,
  ServerErrorCode,
  ServerOptions,
  ServerState,
};

export { HttpServer };

export function createServer(options: ServerOptions): HttpServer {
  return new HttpServer(options);
}

export async function startServer(options: ServerOptions): Promise<HttpServer> {
  const server = new HttpServer(options);
  await server.start();
  return server;
}

export default createServer;

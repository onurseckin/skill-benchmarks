import { ApiRouter, jsonResponse, errorResponse, parsePattern } from "./api-router.js";
import { HttpServer } from "./http-server.js";
import type {
  ApiResponse,
  ApiHealthResponse,
  ApiLeaderboardResponse,
  ApiReplayResponse,
  ApiRunsResponse,
  ApiSummaryResponse,
  ApiTelemetryIngestRequest,
  ApiTrendsResponse,
  HttpMethod,
  HttpServerInstance,
  LiveTelemetryPayload,
  RouteContext,
  RouteDefinition,
  RouteHandler,
  RouterMiddleware,
  ServerOptions,
  ServerState,
  SseClient,
  SseEvent,
  SseEventType,
} from "./types.js";

export type {
  ApiResponse,
  ApiHealthResponse,
  ApiLeaderboardResponse,
  ApiReplayResponse,
  ApiRunsResponse,
  ApiSummaryResponse,
  ApiTelemetryIngestRequest,
  ApiTrendsResponse,
  HttpMethod,
  HttpServerInstance,
  LiveTelemetryPayload,
  RouteContext,
  RouteDefinition,
  RouteHandler,
  RouterMiddleware,
  ServerOptions,
  ServerState,
  SseClient,
  SseEvent,
  SseEventType,
};

export { ApiRouter, HttpServer, jsonResponse, errorResponse, parsePattern };

export function createServer(options?: ServerOptions, router?: ApiRouter): HttpServer {
  return new HttpServer(options, router);
}

export async function startServer(options?: ServerOptions, router?: ApiRouter): Promise<HttpServer> {
  const server = new HttpServer(options, router);
  await server.start();
  return server;
}

export default createServer;

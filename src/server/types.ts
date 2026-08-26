import type { TelemetryDatabase } from "../reporting/db.js";
import type { RunRecord } from "../reporting/types.js";
import type { ReportSnapshot } from "../reporting/report-cohorts.js";
import type { ReplaySession } from "../replay/types.js";

export type HttpMethod = "GET";

export interface ServerOptions {
  readonly outputRoot: string;
  readonly dbPath: string;
  readonly port?: number;
  readonly hostname?: "127.0.0.1";
  readonly quiet?: boolean;
}

export interface ServerState {
  readonly port: number;
  readonly hostname: "127.0.0.1";
  readonly isRunning: boolean;
  readonly startedAt: string;
  readonly url: string;
  readonly totalRequestsHandled: number;
}

export interface RouteContext {
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly db: TelemetryDatabase;
  readonly outputRoot: string;
  readonly serverState: ServerState;
}

export type RouteHandler = (context: RouteContext) => Promise<Response> | Response;

export interface RouteDefinition {
  readonly method: HttpMethod;
  readonly pattern: string;
  readonly regex: RegExp;
  readonly paramNames: readonly string[];
  readonly handler: RouteHandler;
}

export interface ApiSuccessResponse<T> {
  readonly success: true;
  readonly data: T;
  readonly timestamp: string;
}

export type ServerErrorCode =
  | "invalid_request"
  | "method_not_allowed"
  | "route_not_found"
  | "run_not_found"
  | "replay_unavailable"
  | "replay_invalid"
  | "internal_error";

export interface ServerErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: ServerErrorCode;
    readonly message: string;
  };
  readonly timestamp: string;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ServerErrorBody;

export interface ApiRunsResponse {
  readonly runs: readonly RunRecord[];
  readonly total: number;
  readonly offset: number;
  readonly returnedRunCount: number;
  readonly limit?: number;
}

export interface ApiReplayResponse {
  readonly session: ReplaySession;
}

export type ApiLeaderboardResponse = ReportSnapshot;

export type ApiSummaryResponse = ReportSnapshot & {
  readonly summary: {
    readonly lifecycleStatusCounts: ReportSnapshot["provenance"]["lifecycleStatusCounts"];
    readonly eligibleLeaderboard: ReportSnapshot["leaderboard"];
  };
};

export type ApiTrendsResponse = ReportSnapshot & {
  readonly trends: NonNullable<ReportSnapshot["trends"]>;
};

export interface ApiHealthResponse {
  readonly status: "healthy";
  readonly version: string;
  readonly processUptimeSeconds: number;
  readonly processMemoryRssMb: number;
  readonly processHeapUsedMb: number;
  readonly timestamp: string;
}

export interface HttpServerInstance {
  readonly options: ServerOptions;
  readonly url: string;
  readonly port: number;
  readonly hostname: "127.0.0.1";
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): ServerState;
}

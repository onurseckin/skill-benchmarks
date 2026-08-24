import type { TelemetryDatabase } from "../reporting/db.js";
import type {
  EloRatingRecord,
  HistoricalTrendPoint,
  LeaderboardEntry,
  RunMetricsSummary,
  RunQueryFilter,
  RunRecord,
  RunStatus,
  SkillBenchmarkSummary,
} from "../reporting/types.js";
import type {
  CgroupTelemetryPoint,
  DiffDelta,
  ReplaySession,
  ThinkingEvent,
  ToolCallEvent,
  TrajectoryFrame,
} from "../replay/types.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS" | "HEAD" | "PATCH";

export type SseEventType =
  | "telemetry"
  | "turn"
  | "tool"
  | "thinking"
  | "diff"
  | "run_status"
  | "heartbeat"
  | "replay_frame"
  | "error";

export interface ServerOptions {
  readonly port?: number;
  readonly hostname?: string;
  readonly dbPath?: string;
  readonly staticDir?: string;
  readonly corsOrigin?: string | boolean;
  readonly enableSse?: boolean;
  readonly quiet?: boolean;
  readonly db?: TelemetryDatabase;
}

export interface ServerState {
  readonly port: number;
  readonly hostname: string;
  readonly isRunning: boolean;
  readonly activeConnections: number;
  readonly activeSseClients: number;
  readonly startedAt: string;
  readonly url: string;
  readonly totalRequestsHandled: number;
  readonly totalEventsBroadcast: number;
}

export interface RouteContext {
  readonly req: Request;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly url: URL;
  readonly db: TelemetryDatabase;
  readonly serverState: ServerState;
  readonly broadcast: (event: SseEvent, runIdFilter?: string) => void;
}

export type RouteHandler = (ctx: RouteContext) => Promise<Response> | Response;

export interface RouteDefinition {
  readonly method: HttpMethod;
  readonly pattern: string;
  readonly regex: RegExp;
  readonly paramNames: readonly string[];
  readonly handler: RouteHandler;
}

export interface RouterMiddleware {
  readonly name: string;
  readonly handler: (ctx: RouteContext, next: () => Promise<Response>) => Promise<Response>;
}

export interface ApiResponse<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly timestamp: string;
  readonly total?: number;
}

export interface ApiRunsResponse {
  readonly runs: readonly RunRecord[];
  readonly total: number;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface ApiReplayResponse {
  readonly session: ReplaySession;
  readonly totalFrames: number;
}

export interface ApiLeaderboardResponse {
  readonly entries: readonly LeaderboardEntry[];
  readonly eloRatings: readonly EloRatingRecord[];
  readonly total: number;
  readonly lastUpdated: string;
}

export interface ApiSummaryResponse {
  readonly totalRuns: number;
  readonly completedRuns: number;
  readonly failedRuns: number;
  readonly topSkills: readonly SkillBenchmarkSummary[];
  readonly recentRuns: readonly RunRecord[];
}

export interface ApiTrendsResponse {
  readonly skillId?: string;
  readonly trends: readonly HistoricalTrendPoint[];
}

export interface ApiHealthResponse {
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly version: string;
  readonly uptimeSeconds: number;
  readonly activeConnections: number;
  readonly activeSseClients: number;
  readonly memoryRssMb: number;
  readonly heapUsedMb: number;
  readonly timestamp: string;
}

export interface ApiTelemetryIngestRequest {
  readonly runId: string;
  readonly scenarioId: string;
  readonly skillId?: string;
  readonly modelId: string;
  readonly eventType: string;
  readonly timestampUs?: string;
  readonly sequenceNumber?: number;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface LiveTelemetryPayload {
  readonly runId: string;
  readonly scenarioId: string;
  readonly skillId?: string;
  readonly modelId: string;
  readonly timestamp: string;
  readonly eventType: SseEventType | string;
  readonly cgroup?: CgroupTelemetryPoint;
  readonly toolCall?: ToolCallEvent;
  readonly thinking?: ThinkingEvent;
  readonly diff?: DiffDelta;
  readonly frame?: TrajectoryFrame;
  readonly metrics?: Partial<RunMetricsSummary>;
  readonly status?: RunStatus;
  readonly message?: string;
  readonly custom?: Readonly<Record<string, unknown>>;
}

export interface SseEvent {
  readonly id?: string;
  readonly event: SseEventType | string;
  readonly data: unknown;
  readonly retry?: number;
}

export interface SseClient {
  readonly id: string;
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
  readonly connectedAt: string;
  readonly filterRunId?: string;
}

export interface HttpServerInstance {
  readonly options: ServerOptions;
  readonly url: string;
  readonly port: number;
  readonly hostname: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  broadcast(event: SseEvent, runIdFilter?: string): void;
  broadcastTelemetry(payload: LiveTelemetryPayload): void;
  getState(): ServerState;
  getDatabase(): TelemetryDatabase;
}

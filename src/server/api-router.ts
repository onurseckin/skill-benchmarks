import type { TelemetryDatabase } from "../reporting/db.js";
import type {
  LeaderboardEntry,
  EligibleRunRecord,
  RunQueryFilter,
  RunRecord,
  RunStatus,
  SkillBenchmarkSummary,
  TelemetryEventRecord,
} from "../reporting/types.js";
import { aggregateAllSkills, buildLeaderboardEntries as createLeaderboardEntries } from "../reporting/aggregator.js";
import { isEligibleRunRecord } from "../shared/benchmark-authority.js";
import { generateHtmlDashboard } from "../reporting/html-dashboard.js";
import { generateWebReplayHtml } from "../replay/web-player.js";
import { ReplayEngine } from "../replay/replay-engine.js";
import type { ReplaySession } from "../replay/types.js";
import type {
  ApiResponse,
  HttpMethod,
  LiveTelemetryPayload,
  RouteContext,
  RouteDefinition,
  RouteHandler,
  RouterMiddleware,
  ServerState,
  SseEvent,
} from "./types.js";

const DEFAULT_CORS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

export function jsonResponse<T>(data: T, status = 200, headers?: Record<string, string>): Response {
  const body: ApiResponse<T> = {
    success: status >= 200 && status < 300,
    data,
    timestamp: new Date().toISOString(),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...DEFAULT_CORS, ...headers },
  });
}

export function errorResponse(message: string, status = 400, headers?: Record<string, string>): Response {
  const body: ApiResponse<never> = {
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...DEFAULT_CORS, ...headers },
  });
}

export function parsePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = pattern
    .replace(/:([a-zA-Z0-9_]+)/g, (_, name: string) => {
      paramNames.push(name);
      return "([^/]+)";
    })
    .replace(/\*/g, ".*");
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

export class ApiRouter {
  private readonly routes: RouteDefinition[] = [];
  private readonly middlewares: RouterMiddleware[] = [];

  public constructor() {
    this.registerBuiltInRoutes();
  }

  public use(name: string, handler: (ctx: RouteContext, next: () => Promise<Response>) => Promise<Response>): this {
    this.middlewares.push({ name, handler });
    return this;
  }

  public register(method: HttpMethod, pattern: string, handler: RouteHandler): this {
    const { regex, paramNames } = parsePattern(pattern);
    this.routes.push({ method, pattern, regex, paramNames, handler });
    return this;
  }

  public get(pattern: string, handler: RouteHandler): this {
    return this.register("GET", pattern, handler);
  }

  public post(pattern: string, handler: RouteHandler): this {
    return this.register("POST", pattern, handler);
  }

  public async handle(
    req: Request,
    db: TelemetryDatabase,
    serverState: ServerState,
    broadcast: (event: SseEvent, runIdFilter?: string) => void
  ): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: DEFAULT_CORS });
    }

    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method as HttpMethod;

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = path.match(route.regex);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, index) => {
        const val = match[index + 1];
        if (val !== undefined) params[name] = decodeURIComponent(val);
      });

      const ctx: RouteContext = { req, params, query: url.searchParams, url, db, serverState, broadcast };
      return this.executePipeline(ctx, route.handler);
    }

    return errorResponse(`Route not found: ${method} ${path}`, 404);
  }

  private async executePipeline(ctx: RouteContext, finalHandler: RouteHandler): Promise<Response> {
    let index = 0;
    const next = async (): Promise<Response> => {
      if (index < this.middlewares.length) {
        const middleware = this.middlewares[index++];
        if (middleware) return middleware.handler(ctx, next);
      }
      return finalHandler(ctx);
    };
    try {
      return await next();
    } catch (err) {
      return errorResponse(`Internal server error: ${err instanceof Error ? err.message : String(err)}`, 500);
    }
  }

  private registerBuiltInRoutes(): void {
    this.get("/api/health", (ctx) => {
      const mem = process.memoryUsage();
      return jsonResponse({
        status: "healthy",
        version: "0.1.0",
        uptimeSeconds: Math.floor((Date.now() - new Date(ctx.serverState.startedAt).getTime()) / 1000),
        activeConnections: ctx.serverState.activeConnections,
        activeSseClients: ctx.serverState.activeSseClients,
        memoryRssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
        timestamp: new Date().toISOString(),
      });
    });

    this.get("/api/runs", (ctx) => {
      const filter = this.buildRunQueryFilter(ctx.query);
      const runs = ctx.db.queryRuns(filter);
      const limit = filter.limit ?? runs.length;
      const offset = filter.offset ?? 0;
      return jsonResponse({
        runs,
        total: runs.length,
        page: limit > 0 ? Math.floor(offset / limit) + 1 : 1,
        pageSize: limit,
      });
    });

    this.get("/api/runs/:id", (ctx) => {
      const id = ctx.params.id ?? "";
      const run = ctx.db.queryRuns({ limit: 1000 }).find((r) => r.runId === id);
      return run ? jsonResponse(run) : errorResponse(`Run record not found: ${id}`, 404);
    });

    this.get("/api/replay/:id", (ctx) => {
      const id = ctx.params.id ?? "";
      const run = ctx.db.queryRuns({ limit: 1000 }).find((r) => r.runId === id);
      const session = this.buildReplaySessionFromRun(id, run);
      return jsonResponse({ session, totalFrames: session.frames.length });
    });

    this.get("/api/leaderboard", (ctx) => {
      const eloRatings = ctx.db.getEloLeaderboard();
      const runs = ctx.db.queryEligibleRuns();
      const entries = this.buildLeaderboardEntries(runs, eloRatings);
      const cat = ctx.query.get("category");
      const filtered = cat && cat !== "all" ? entries.filter((e) => e.category === cat) : entries;
      return jsonResponse({ entries: filtered, eloRatings, total: filtered.length, lastUpdated: new Date().toISOString() });
    });

    this.get("/api/trends", (ctx) => {
      const skillId = ctx.query.get("skillId") ?? undefined;
      return jsonResponse({ skillId, trends: ctx.db.getHistoricalTrends(skillId) });
    });

    this.get("/api/summary", (ctx) => {
      const runs = ctx.db.queryRuns();
      const eligibleRuns = ctx.db.queryEligibleRuns();
      const completed = runs.filter((r) => r.status === "completed").length;
      const failed = runs.filter((r) => r.status === "failed" || r.status === "timed_out").length;
      return jsonResponse({
        totalRuns: runs.length,
        completedRuns: completed,
        failedRuns: failed,
        topSkills: this.buildSkillSummaries(eligibleRuns).slice(0, 10),
        recentRuns: runs.slice(-10).reverse(),
      });
    });

    this.post("/api/telemetry/live", async (ctx) => {
      try {
        const body = (await ctx.req.json()) as LiveTelemetryPayload;
        if (!body.runId || !body.scenarioId || !body.modelId) {
          return errorResponse("Missing mandatory fields: runId, scenarioId, modelId", 400);
        }
        const eventRecord: TelemetryEventRecord = {
          runId: body.runId,
          scenarioId: body.scenarioId,
          skillId: body.skillId,
          modelId: body.modelId,
          timestampUs: String(Date.now() * 1000),
          eventType: body.eventType ?? "telemetry",
          payload: (body.custom ?? body) as Readonly<Record<string, unknown>>,
        };
        ctx.db.saveTelemetryEvents([eventRecord]);
        ctx.broadcast({ event: body.eventType ?? "telemetry", data: body }, body.runId);
        return jsonResponse({ ingested: true, runId: body.runId });
      } catch (err) {
        return errorResponse(`Malformed telemetry payload: ${String(err)}`, 400);
      }
    });

    this.get("/", (ctx) => {
      const runs = ctx.db.queryEligibleRuns();
      const entries = this.buildLeaderboardEntries(runs, ctx.db.getEloLeaderboard());
      const summaries = this.buildSkillSummaries(runs);
      const html = generateHtmlDashboard(summaries, entries, [], {
        title: "Skill Benchmarks Live Dashboard",
        totalRuns: runs.length,
        lastUpdated: new Date().toISOString(),
      });
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    });

    this.get("/replay/:id", (ctx) => {
      const id = ctx.params.id ?? "";
      const run = ctx.db.queryRuns({ limit: 1000 }).find((r) => r.runId === id);
      const session = this.buildReplaySessionFromRun(id, run);
      return new Response(generateWebReplayHtml(session), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    });
  }

  private buildRunQueryFilter(query: URLSearchParams): RunQueryFilter {
    const filter: Record<string, unknown> = {};
    if (query.has("scenarioId")) filter.scenarioId = query.get("scenarioId")!;
    if (query.has("skillId")) filter.skillId = query.get("skillId")!;
    if (query.has("modelId")) filter.modelId = query.get("modelId")!;
    if (query.has("providerId")) filter.providerId = query.get("providerId")!;
    if (query.has("category")) filter.category = query.get("category")!;
    if (query.has("status")) filter.status = query.get("status")! as RunStatus;
    if (query.has("passedBenchmark")) filter.passedBenchmark = query.get("passedBenchmark") === "true";
    if (query.has("minScore")) filter.minScore = parseFloat(query.get("minScore")!);
    if (query.has("maxScore")) filter.maxScore = parseFloat(query.get("maxScore")!);
    if (query.has("fromDate")) filter.fromDate = query.get("fromDate")!;
    if (query.has("toDate")) filter.toDate = query.get("toDate")!;
    if (query.has("limit")) filter.limit = parseInt(query.get("limit")!, 10);
    if (query.has("offset")) filter.offset = parseInt(query.get("offset")!, 10);
    return filter as RunQueryFilter;
  }

  private buildReplaySessionFromRun(id: string, run?: RunRecord): ReplaySession {
    const eligibleRun = run !== undefined && isEligibleRunRecord(run) ? run : undefined;
    const engine = new ReplayEngine({
      sessionId: `replay-${id}`,
      runId: id,
      scenarioId: run?.scenarioId ?? id,
      skillId: run?.skillId ?? "unknown",
      modelId: run?.modelId ?? "unknown",
      providerId: run?.providerId ?? "unknown",
      status: run?.status ?? "completed",
      ...(eligibleRun === undefined ? {} : { score: eligibleRun.compositeScore }),
      totalTurns: run?.totalTurns ?? 1,
      totalTokens: run?.totalTokens ?? 0,
      ...(eligibleRun?.actualCostUSD === undefined ? {} : { totalCostUSD: eligibleRun.actualCostUSD }),
      durationMs: run?.wallClockMs ?? 0,
    });
    engine.recordEvent({ type: "run:start", timestamp: run?.startedAt ?? new Date().toISOString() });
    engine.recordEvent({
      type: "RESOURCE_SAMPLE",
      timestamp: run?.completedAt ?? new Date().toISOString(),
      cpuPercent: 12.5,
      memoryRssMb: 128,
      memoryLimitMb: 512,
      memoryPercent: 25,
      diskReadKb: 0,
      diskWriteKb: 0,
      networkRxKb: 0,
      networkTxKb: 0,
      activePids: 1,
    });
    engine.recordEvent({ type: "run:finish", timestamp: run?.completedAt ?? new Date().toISOString() });
    return engine.getSession();
  }

  private buildSkillSummaries(runs: readonly EligibleRunRecord[]): readonly SkillBenchmarkSummary[] {
    return aggregateAllSkills(runs);
  }

  private buildLeaderboardEntries(
    runs: readonly EligibleRunRecord[],
    eloRatings: readonly { skillId: string; rating: number }[]
  ): readonly LeaderboardEntry[] {
    return createLeaderboardEntries(runs, undefined, eloRatings);
  }
}

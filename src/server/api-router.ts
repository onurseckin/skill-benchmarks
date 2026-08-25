import type { TelemetryDatabase } from "../reporting/db.js";
import type { RunRecord, TelemetryEventRecord } from "../reporting/types.js";
import { generateWebReplayHtml } from "../replay/web-player.js";
import { createRunArtifactLayout } from "../infrastructure/workspace/run-artifact-layout.js";
import { loadReplaySession } from "../replay/event-session-loader.js";
import { ReplayEvidenceInvalidError, ReplayEvidenceUnavailableError } from "../replay/errors.js";
import type { ReplayEvidenceIdentity, ReplaySession } from "../replay/types.js";
import type {
  HttpMethod,
  LiveTelemetryPayload,
  RouteContext,
  RouteDefinition,
  RouteHandler,
  RouterMiddleware,
  ServerState,
  SseEvent,
} from "./types.js";
import { defaultCorsHeaders, errorResponse, jsonResponse } from "./http-responses.js";
import { registerReportRoutes } from "./report-routes.js";

export { errorResponse, jsonResponse } from "./http-responses.js";

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
    outputRoot: string,
    serverState: ServerState,
    broadcast: (event: SseEvent, runIdFilter?: string) => void
  ): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: defaultCorsHeaders });
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

      const ctx: RouteContext = { req, params, query: url.searchParams, url, db, outputRoot, serverState, broadcast };
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
    } catch {
      return errorResponse("Internal server error", 500);
    }
  }

  private registerBuiltInRoutes(): void {
    registerReportRoutes(this);
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

    this.get("/api/runs/:id", (ctx) => {
      const id = ctx.params.id ?? "";
      const run = ctx.db.getRunRecord(id);
      return run ? jsonResponse(run) : errorResponse(`Run record not found: ${id}`, 404);
    });

    this.get("/api/replay/:id", (ctx) => {
      const id = ctx.params.id ?? "";
      const replay = this.loadPersistedReplay(ctx, id);
      return replay instanceof Response ? replay : jsonResponse({ session: replay });
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

    this.get("/replay/:id", (ctx) => {
      const id = ctx.params.id ?? "";
      const replay = this.loadPersistedReplay(ctx, id);
      if (replay instanceof Response) return replay;
      return new Response(generateWebReplayHtml(replay), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    });
  }

  private loadPersistedReplay(ctx: RouteContext, id: string): ReplaySession | Response {
    let record: RunRecord | undefined;
    try {
      record = ctx.db.getRunRecord(id);
    } catch {
      return errorResponse("Replay record is invalid", 422);
    }
    if (record === undefined) return errorResponse("Replay run was not found", 404);
    try {
      const layout = createRunArtifactLayout(ctx.outputRoot, id);
      return loadReplaySession({
        eventsPath: layout.eventsPath,
        manifestPath: layout.manifestPath,
        resultPath: layout.resultPath,
        expectedRunId: id,
        expectedIdentity: createExpectedReplayIdentity(record),
      });
    } catch (error) {
      if (error instanceof ReplayEvidenceUnavailableError) return errorResponse("Replay evidence is unavailable", 409);
      if (error instanceof ReplayEvidenceInvalidError || error instanceof TypeError) return errorResponse("Replay evidence is invalid", 422);
      return errorResponse("Replay evidence could not be read", 500);
    }
  }

}

function createExpectedReplayIdentity(record: RunRecord): ReplayEvidenceIdentity {
  return {
    sourceKind: "canonical-run",
    runId: record.runId,
    sweepId: record.sweepId,
    cellId: record.cellId,
    planFingerprint: record.planFingerprint,
    matrixOccurrenceIndex: requireMatrixOccurrenceIndex(record.matrixOccurrenceIndex),
    scenarioId: record.scenarioId,
    category: record.category,
    skillId: record.skillId,
    modelId: record.modelId,
    providerId: record.providerId,
    executionMode: record.executionMode,
    simulated: record.simulated,
    dryRun: record.dryRun,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    status: record.status,
    terminationReason: record.terminationReason,
    durationMs: record.wallClockMs,
    totalCostUSD: record.operationalCost.amountUSD,
    totalTurns: record.totalTurns,
    totalTokens: record.totalTokens,
    benchmarkCohort: record.benchmarkCohort,
    eligibilityStatus: record.eligibility.status,
    eligibilityReasons: record.eligibility.reasons,
    evaluationStatus: record.evaluation.status,
  };
}

function requireMatrixOccurrenceIndex(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Replay run identity is incomplete");
  }
  return value;
}

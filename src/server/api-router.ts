import { createRunArtifactLayout } from "../infrastructure/workspace/run-artifact-layout.js";
import type { TelemetryDatabase } from "../reporting/db.js";
import type { RunRecord } from "../reporting/types.js";
import { ReplayEvidenceInvalidError, ReplayEvidenceUnavailableError } from "../replay/errors.js";
import { loadReplaySession } from "../replay/event-session-loader.js";
import type { ReplayEvidenceIdentity, ReplaySession } from "../replay/types.js";
import { generateWebReplayHtml } from "../replay/web-player.js";
import { registerReportRoutes } from "./report-routes.js";
import { errorResponse, headResponse, htmlResponse, jsonResponse } from "./server-response.js";
import type {
  HttpMethod,
  RouteContext,
  RouteDefinition,
  RouteHandler,
  ServerState,
} from "./types.js";

export function parsePattern(pattern: string): {
  readonly regex: RegExp;
  readonly paramNames: readonly string[];
} {
  const paramNames: string[] = [];
  const regexValue = pattern.replace(/:([a-zA-Z0-9_]+)/g, (_, name: string) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${regexValue}$`), paramNames: Object.freeze(paramNames) };
}

export class ApiRouter {
  private readonly routes: RouteDefinition[] = [];

  public constructor() {
    registerReportRoutes(this);
    this.registerBuiltInRoutes();
  }

  public register(method: HttpMethod, pattern: string, handler: RouteHandler): this {
    const { regex, paramNames } = parsePattern(pattern);
    this.routes.push(Object.freeze({ method, pattern, regex, paramNames, handler }));
    return this;
  }

  public async handle(
    request: Request,
    database: TelemetryDatabase,
    outputRoot: string,
    serverState: ServerState,
  ): Promise<Response> {
    let url: URL;
    try {
      url = new URL(request.url);
      decodeURIComponent(url.pathname);
    } catch {
      return errorResponse("invalid_request", 400);
    }
    const route = this.routes.find((candidate) => candidate.regex.test(url.pathname));
    if (route === undefined) return errorResponse("route_not_found", 404);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse("method_not_allowed", 405, { Allow: "GET, HEAD" });
    }
    let params: Readonly<Record<string, string>>;
    try {
      params = readParameters(route, url.pathname);
    } catch {
      return errorResponse("invalid_request", 400);
    }
    const context: RouteContext = {
      params,
      query: url.searchParams,
      db: database,
      outputRoot,
      serverState,
    };
    try {
      const response = await route.handler(context);
      return request.method === "HEAD" ? headResponse(response) : response;
    } catch {
      return errorResponse("internal_error", 500);
    }
  }

  private registerBuiltInRoutes(): void {
    this.register("GET", "/api/health", (context) => {
      const memory = process.memoryUsage();
      return jsonResponse({
        status: "healthy",
        version: "0.1.0",
        processUptimeSeconds: Math.max(
          0,
          Math.floor((Date.now() - Date.parse(context.serverState.startedAt)) / 1000),
        ),
        processMemoryRssMb: roundMegabytes(memory.rss),
        processHeapUsedMb: roundMegabytes(memory.heapUsed),
        timestamp: new Date().toISOString(),
      });
    });
    this.register("GET", "/api/runs/:id", (context) => {
      const run = context.db.getRunRecord(context.params.id ?? "");
      return run === undefined ? errorResponse("run_not_found", 404) : jsonResponse(run);
    });
    this.register("GET", "/api/replay/:id", (context) => {
      const replay = loadPersistedReplay(context, context.params.id ?? "");
      return replay instanceof Response ? replay : jsonResponse({ session: replay });
    });
    this.register("GET", "/replay/:id", (context) => {
      const replay = loadPersistedReplay(context, context.params.id ?? "");
      return replay instanceof Response ? replay : htmlResponse(generateWebReplayHtml(replay));
    });
  }
}

function readParameters(route: RouteDefinition, path: string): Readonly<Record<string, string>> {
  const match = path.match(route.regex);
  if (match === null) return Object.freeze({});
  return Object.freeze(
    Object.fromEntries(
      route.paramNames.map((name, index) => [name, decodeURIComponent(match[index + 1] ?? "")]),
    ),
  );
}

function loadPersistedReplay(context: RouteContext, runId: string): ReplaySession | Response {
  let record: RunRecord | undefined;
  try {
    record = context.db.getRunRecord(runId);
  } catch {
    return errorResponse("internal_error", 500);
  }
  if (record === undefined) return errorResponse("run_not_found", 404);
  try {
    const layout = createRunArtifactLayout(context.outputRoot, runId);
    return loadReplaySession({
      eventsPath: layout.eventsPath,
      manifestPath: layout.manifestPath,
      resultPath: layout.resultPath,
      expectedRunId: runId,
      expectedIdentity: createExpectedReplayIdentity(record),
    });
  } catch (error) {
    if (error instanceof ReplayEvidenceUnavailableError)
      return errorResponse("replay_unavailable", 409);
    if (error instanceof ReplayEvidenceInvalidError || error instanceof TypeError)
      return errorResponse("replay_invalid", 422);
    return errorResponse("internal_error", 500);
  }
}

function createExpectedReplayIdentity(record: RunRecord): ReplayEvidenceIdentity {
  if (
    record.matrixOccurrenceIndex === undefined ||
    !Number.isSafeInteger(record.matrixOccurrenceIndex) ||
    record.matrixOccurrenceIndex < 0
  ) {
    throw new ReplayEvidenceInvalidError();
  }
  return {
    sourceKind: "canonical-run",
    runId: record.runId,
    sweepId: record.sweepId,
    cellId: record.cellId,
    planFingerprint: record.planFingerprint,
    matrixOccurrenceIndex: record.matrixOccurrenceIndex,
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

function roundMegabytes(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

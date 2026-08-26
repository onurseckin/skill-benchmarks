import { generateHtmlDashboard } from "../reporting/html-dashboard.js";
import {
  buildReportSnapshot,
  normalizeReportFilter,
} from "../reporting/report-cohorts.js";
import type {
  ReportBuildOptions,
  ReportFilter,
  RunQueryFilter,
} from "../reporting/report-cohorts.js";
import { normalizeRunQueryFilter } from "../reporting/run-query.js";
import { errorResponse, htmlResponse, jsonResponse } from "./server-response.js";
import type { HttpMethod, RouteContext, RouteHandler } from "./types.js";

export interface ReportRouteRegistrar {
  register(method: HttpMethod, pattern: string, handler: RouteHandler): unknown;
}

const reportParameters = new Set([
  "scenarioId", "category", "skillId", "modelId", "providerId", "status",
  "executionMode", "simulated", "authority", "cohort", "eligibility",
  "evaluationStatus", "evidenceStatus", "fromDate", "toDate",
]);
const runParameters = new Set([
  ...reportParameters, "passedBenchmark", "minScore", "maxScore", "limit", "offset",
]);

export function registerReportRoutes(router: ReportRouteRegistrar): void {
  router.register("GET", "/api/runs", (context) => {
    const filter = parseQuery(() => parseRunQuery(context.query));
    if (filter instanceof Response) return filter;
    const runs = context.db.queryRuns(filter);
    const total = context.db.countRuns(filter);
    return jsonResponse({
      runs,
      total,
      offset: filter.offset ?? 0,
      returnedRunCount: runs.length,
      ...(filter.limit === undefined ? {} : { limit: filter.limit }),
    });
  });

  router.register("GET", "/api/leaderboard", (context) => {
    const filter = parseQuery(() => parseReportQuery(context.query));
    return filter instanceof Response ? filter : jsonResponse(buildSnapshot(context, filter));
  });

  router.register("GET", "/api/trends", (context) => {
    const filter = parseQuery(() => parseReportQuery(context.query));
    return filter instanceof Response ? filter : jsonResponse(buildSnapshot(context, filter, { includeTrends: true }));
  });

  router.register("GET", "/api/summary", (context) => {
    const filter = parseQuery(() => parseReportQuery(context.query));
    if (filter instanceof Response) return filter;
    const snapshot = buildSnapshot(context, filter);
    return jsonResponse({
      ...snapshot,
      summary: {
        lifecycleStatusCounts: snapshot.provenance.lifecycleStatusCounts,
        eligibleLeaderboard: snapshot.leaderboard,
      },
    });
  });

  router.register("GET", "/", (context) => {
    const filter = parseQuery(() => parseReportQuery(context.query));
    if (filter instanceof Response) return filter;
    const snapshot = buildSnapshot(context, filter, {
      includeTrends: true,
      includeCostEfficiency: true,
    });
    return htmlResponse(generateHtmlDashboard(snapshot, { title: "Skill Benchmarks Live Evidence" }));
  });
}

export function parseReportQuery(query: URLSearchParams): ReportFilter {
  requireAllowedParameters(query, reportParameters);
  return normalizeReportFilter({
    ...readArray(query, "scenarioId", "scenarioIds"),
    ...readArray(query, "category", "categories"),
    ...readArray(query, "skillId", "skillIds"),
    ...readArray(query, "modelId", "modelIds"),
    ...readArray(query, "providerId", "providerIds"),
    ...readArray(query, "status", "statuses"),
    ...readArray(query, "executionMode", "executionModes"),
    ...readBoolean(query, "simulated"),
    ...readScalar(query, "authority"),
    ...readArray(query, "cohort", "benchmarkCohorts"),
    ...readArray(query, "eligibility", "eligibilityStatuses"),
    ...readArray(query, "evaluationStatus", "evaluationStatuses"),
    ...readArray(query, "evidenceStatus", "evidenceStatuses"),
    ...readScalar(query, "fromDate"),
    ...readScalar(query, "toDate"),
  } as Parameters<typeof normalizeReportFilter>[0]);
}

export function parseRunQuery(query: URLSearchParams): RunQueryFilter {
  requireAllowedParameters(query, runParameters);
  const reportQuery = new URLSearchParams(query);
  for (const key of ["passedBenchmark", "minScore", "maxScore", "limit", "offset"]) reportQuery.delete(key);
  const report = parseReportQuery(reportQuery);
  return normalizeRunQueryFilter({
    ...report,
    ...readBoolean(query, "passedBenchmark"),
    ...readNumber(query, "minScore"),
    ...readNumber(query, "maxScore"),
    ...readNumber(query, "limit"),
    ...readNumber(query, "offset"),
  });
}

function buildSnapshot(context: RouteContext, filter: ReportFilter, options?: ReportBuildOptions) {
  const runs = context.db.queryRuns(filter);
  return buildReportSnapshot(runs, filter, options);
}

function parseQuery<T>(operation: () => T): T | Response {
  try {
    return operation();
  } catch (error) {
    if (error instanceof TypeError) return errorResponse("invalid_request", 400);
    throw error;
  }
}

function requireAllowedParameters(query: URLSearchParams, allowed: ReadonlySet<string>): void {
  for (const key of query.keys()) if (!allowed.has(key)) throw new TypeError("Unknown report query parameter");
}

function readArray(query: URLSearchParams, parameter: string, key: string): Record<string, readonly string[]> {
  if (!query.has(parameter)) return {};
  const values = query.getAll(parameter).flatMap((value) => value.split(","));
  return { [key]: values };
}

function readScalar(query: URLSearchParams, parameter: string): Record<string, string> {
  if (!query.has(parameter)) return {};
  const values = query.getAll(parameter);
  if (values.length !== 1) throw new TypeError("Report scalar query parameter is repeated");
  return { [parameter]: values[0] as string };
}

function readBoolean(query: URLSearchParams, parameter: string): Record<string, boolean> {
  if (!query.has(parameter)) return {};
  const values = query.getAll(parameter);
  if (values.length !== 1 || (values[0] !== "true" && values[0] !== "false")) throw new TypeError("Report boolean query parameter is invalid");
  return { [parameter]: values[0] === "true" };
}

function readNumber(query: URLSearchParams, parameter: string): Record<string, number> {
  if (!query.has(parameter)) return {};
  const values = query.getAll(parameter);
  if (values.length !== 1 || values[0]?.trim().length === 0) throw new TypeError("Report numeric query parameter is invalid");
  const value = Number(values[0]);
  if (!Number.isFinite(value)) throw new TypeError("Report numeric query parameter is invalid");
  return { [parameter]: value };
}

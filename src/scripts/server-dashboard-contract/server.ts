import { Database } from "bun:sqlite";
import { lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../../server/index.js";
import type { ServerOptions } from "../../server/types.js";
import { readJson, requireCondition, requireError, requireSecureHeaders } from "./assertions.js";
import type { ServerDashboardFixture } from "./fixture.js";

interface DatabaseCounts {
  readonly runs: number;
  readonly claims: number;
  readonly telemetry: number;
  readonly rankedHistoryObjects: number;
}

export async function verifyServerContract(fixture: ServerDashboardFixture): Promise<void> {
  const before = readDatabaseCounts(fixture.dbPath);
  const server = await startServer({
    port: 0,
    hostname: "127.0.0.1",
    dbPath: fixture.dbPath,
    outputRoot: fixture.outputRoot,
    quiet: true,
  });
  requireCondition(server.hostname === "127.0.0.1", "server_hostname_invalid");
  requireCondition(server.url.startsWith("http://127.0.0.1:"), "server_url_invalid");
  const initialPort = server.port;
  const origin = server.url;
  await server.start();
  requireCondition(server.port === initialPort, "server_duplicate_start_invalid");
  try {
    const listener = Bun.spawnSync(["lsof", "-nP", `-iTCP:${server.port}`, "-sTCP:LISTEN"], {
      stdout: "pipe",
    });
    const listenerText = new TextDecoder().decode(listener.stdout);
    requireCondition(
      listenerText.includes(`127.0.0.1:${server.port}`) &&
        !listenerText.includes(`*:${server.port}`),
      "server_bind_invalid",
    );
    await verifyReadRoutes(server.url, fixture.runId);
    await verifyRejectedRoutes(server.url);
    requireCondition(
      equalCounts(before, readDatabaseCounts(fixture.dbPath)),
      "server_database_mutated",
    );
  } finally {
    await server.stop();
  }
  await requireListenerClosed(origin);
  await server.stop();
  await verifyInvalidConstruction(fixture);
}

async function verifyReadRoutes(origin: string, runId: string): Promise<void> {
  for (const resource of [
    "/api/health",
    "/api/runs",
    "/api/leaderboard",
    "/api/trends",
    "/api/summary",
    "/",
  ]) {
    const response = await fetch(`${origin}${resource}`);
    requireCondition(response.status === 200, "server_read_route_failed");
    requireSecureHeaders(response);
  }
  const runResponse = await fetch(`${origin}/api/runs/${encodeURIComponent(runId)}`);
  requireCondition(runResponse.status === 200, "server_run_route_failed");
  const replayResponse = await fetch(`${origin}/api/replay/${encodeURIComponent(runId)}`);
  requireCondition(replayResponse.status === 200, "server_replay_route_failed");
  const replayHtml = await fetch(`${origin}/replay/${encodeURIComponent(runId)}`);
  requireCondition(replayHtml.status === 200, "server_replay_html_failed");
  requireCondition(
    replayHtml.headers.get("content-security-policy")?.includes("default-src 'none'") === true,
    "server_csp_missing",
  );
  const leaderboard = await readJson(await fetch(`${origin}/api/leaderboard`));
  const data = leaderboard.data as Record<string, unknown>;
  requireCondition(
    data.eligibleRunCount === 0 && Array.isArray(data.leaderboard) && data.leaderboard.length === 0,
    "server_leaderboard_claim_invalid",
  );
}

async function verifyRejectedRoutes(origin: string): Promise<void> {
  await requireError(await fetch(`${origin}/api/runs/missing`), 404, "run_not_found");
  await requireError(await fetch(`${origin}/api/replay/missing`), 404, "run_not_found");
  await requireError(await fetch(`${origin}/replay/missing`), 404, "run_not_found");
  await requireError(await fetch(`${origin}/api/runs?limit=banana`), 400, "invalid_request");
  await requireError(await fetch(`${origin}/%E0%A4%A`), 400, "invalid_request");
  await requireError(await fetch(`${origin}/definitely-missing`), 404, "route_not_found");
  const writeRoute = ["api", "telemetry", "live"].join("/");
  const write = await fetch(`${origin}/${writeRoute}`, { method: "POST", body: "{}" });
  await requireError(write, 404, "route_not_found");
  requireCondition(write.headers.get("allow") === null, "write_allow_invalid");
  const eventStreamRoute = ["api", "sse"].join("/");
  await requireError(await fetch(`${origin}/${eventStreamRoute}`), 404, "route_not_found");
  await requireError(await fetch(`${origin}/tunnel`), 404, "route_not_found");
  const options = await fetch(`${origin}/api/runs`, { method: "OPTIONS" });
  await requireError(options, 405, "method_not_allowed");
  requireCondition(options.headers.get("allow") === "GET, HEAD", "options_allow_invalid");
  const knownPost = await fetch(`${origin}/api/runs`, { method: "POST", body: "{}" });
  await requireError(knownPost, 405, "method_not_allowed");
  requireCondition(knownPost.headers.get("allow") === "GET, HEAD", "known_post_allow_invalid");
  const unknownPost = await fetch(`${origin}/definitely-missing`, { method: "POST", body: "{}" });
  await requireError(unknownPost, 404, "route_not_found");
  requireCondition(unknownPost.headers.get("allow") === null, "unknown_post_allow_invalid");
}

function readDatabaseCounts(path: string): DatabaseCounts {
  const database = new Database(path, { readonly: true });
  try {
    return {
      runs: readCount(database, "runs"),
      claims: readCount(database, "run_claims"),
      telemetry: readCount(database, "telemetry_events"),
      rankedHistoryObjects: readRankedHistoryObjects(database),
    };
  } finally {
    database.close();
  }
}

function readCount(database: Database, table: string): number {
  const row = database.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    readonly count: number;
  };
  return row.count;
}

function equalCounts(left: DatabaseCounts, right: DatabaseCounts): boolean {
  return (
    left.runs === right.runs &&
    left.claims === right.claims &&
    left.telemetry === right.telemetry &&
    left.rankedHistoryObjects === 0 &&
    right.rankedHistoryObjects === 0
  );
}

function readRankedHistoryObjects(database: Database): number {
  const row = database
    .query("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'elo_ratings'")
    .get() as { readonly count: number };
  return row.count;
}

async function requireListenerClosed(origin: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    await fetch(origin, { signal: controller.signal });
    throw new TypeError("server_listener_survived");
  } catch (error) {
    requireCondition(
      error instanceof Error && error.message !== "server_listener_survived",
      "server_listener_survived",
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyInvalidConstruction(fixture: ServerDashboardFixture): Promise<void> {
  const invalidRoot = join(fixture.root, "invalid");
  mkdirSync(invalidRoot);
  const missingDb = join(invalidRoot, "missing.sqlite");
  const missingOutput = join(invalidRoot, "missing-output");
  const dbLink = join(invalidRoot, "db-link.sqlite");
  const outputLink = join(invalidRoot, "output-link");
  symlinkSync(fixture.dbPath, dbLink);
  symlinkSync(fixture.outputRoot, outputLink);
  const cases: readonly Record<string, unknown>[] = [
    { hostname: ["0.0", "0.0"].join("."), dbPath: fixture.dbPath, outputRoot: fixture.outputRoot },
    { hostname: "::", dbPath: fixture.dbPath, outputRoot: fixture.outputRoot },
    { hostname: "127.0.0.1", dbPath: "", outputRoot: fixture.outputRoot },
    { hostname: "127.0.0.1", dbPath: missingDb, outputRoot: fixture.outputRoot },
    { hostname: "127.0.0.1", dbPath: dbLink, outputRoot: fixture.outputRoot },
    { hostname: "127.0.0.1", dbPath: fixture.dbPath, outputRoot: missingOutput },
    { hostname: "127.0.0.1", dbPath: fixture.dbPath, outputRoot: outputLink },
    { hostname: "127.0.0.1", dbPath: fixture.dbPath, outputRoot: invalidRoot },
  ];
  for (const value of cases) {
    let rejected = false;
    try {
      const server = await startServer({
        port: 0,
        quiet: true,
        ...value,
      } as unknown as ServerOptions);
      await server.stop();
    } catch {
      rejected = true;
    }
    requireCondition(rejected, "server_invalid_construction_accepted");
  }
  requireCondition(
    !lstatSync(dbLink).isFile() && readlinkSync(dbLink) === fixture.dbPath,
    "server_db_link_mutated",
  );
  requireCondition(
    !lstatSync(outputLink).isDirectory() && readlinkSync(outputLink) === fixture.outputRoot,
    "server_output_link_mutated",
  );
}

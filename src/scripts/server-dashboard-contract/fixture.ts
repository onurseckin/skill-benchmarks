import { mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { requireCondition } from "./assertions.js";

export interface ServerDashboardFixture {
  readonly root: string;
  readonly outputRoot: string;
  readonly dbPath: string;
  readonly runId: string;
  readonly eventsPath: string;
  readonly reportPath: string;
  readonly reportJsonPath: string;
  readonly replayPath: string;
  readonly replayJsonPath: string;
}

export function createServerDashboardFixture(): ServerDashboardFixture {
  const root = mkdtempSync(join(tmpdir(), "skill-benchmarks-server-dashboard-"));
  const outputRoot = join(root, "runtime");
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !credentialKeys.has(key)),
  );
  environment.SKILL_BENCHMARKS_USE_MOCK = "true";
  runCommand(
    [
      "run",
      "--scenario",
      "git-worktrees",
      "--skill",
      "tdd",
      "--model",
      "gpt-4o",
      "--output-dir",
      outputRoot,
    ],
    environment,
  );
  const runIds = readdirSync(join(outputRoot, "runs"));
  requireCondition(runIds.length === 1 && runIds[0] !== undefined, "fixture_run_missing");
  const runId = runIds[0];
  const dbPath = join(outputRoot, "db", "benchmarks.sqlite");
  const reportPath = join(root, "report.html");
  const reportJsonPath = join(root, "report.json");
  const replayPath = join(root, "replay.html");
  const replayJsonPath = join(root, "replay.json");
  runCommand(["report", "--db", dbPath, "--format", "html", "--output", reportPath], environment);
  runCommand(
    ["report", "--db", dbPath, "--format", "json", "--output", reportJsonPath],
    environment,
  );
  runCommand(
    [
      "replay",
      "--run-id",
      runId,
      "--db",
      dbPath,
      "--output-dir",
      outputRoot,
      "--format",
      "html",
      "--output",
      replayPath,
    ],
    environment,
  );
  runCommand(
    [
      "replay",
      "--run-id",
      runId,
      "--db",
      dbPath,
      "--output-dir",
      outputRoot,
      "--format",
      "json",
      "--output",
      replayJsonPath,
    ],
    environment,
  );
  return {
    root,
    outputRoot,
    dbPath,
    runId,
    eventsPath: join(outputRoot, "runs", runId, "events.jsonl"),
    reportPath,
    reportJsonPath,
    replayPath,
    replayJsonPath,
  };
}

function runCommand(
  args: readonly string[],
  environment: Record<string, string | undefined>,
): void {
  const result = Bun.spawnSync(
    [process.execPath, "--no-env-file", "bin/skill-benchmarks", ...args],
    {
      cwd: process.cwd(),
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  requireCondition(result.exitCode === 0, "fixture_command_failed");
}

const credentialKeys = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
]);

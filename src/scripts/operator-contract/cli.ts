import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseJsonRecord, requireCondition, requireNoTerminalEscapes } from "./assertions.js";
import { runCommand, runSuccessfulCommand } from "./command.js";
import { createNoKeyEnvironment, repositoryRoot } from "./fixture.js";

export async function verifyInvalidCli(temporaryRoot: string): Promise<void> {
  const environment = createNoKeyEnvironment(temporaryRoot);
  const unresolvedRoot = join(temporaryRoot, "unresolved");
  const cases = [
    {
      args: ["bun", "run", "cli", "--", "unknown"],
      code: "unknown_command",
    },
    {
      args: ["bun", "run", "cli", "--", "run", "--skill", "tdd", "--unknown"],
      code: "unknown_flag",
    },
    {
      args: [
        "bun",
        "run",
        "cli",
        "--",
        "run",
        "--scenario",
        "missing",
        "--skill",
        "tdd",
        "--output-dir",
        unresolvedRoot,
      ],
      code: "scenario_unresolved",
    },
    {
      args: [
        "bun",
        "run",
        "cli",
        "--",
        "run",
        "--scenario",
        "git-worktrees",
        "--skill",
        "missing",
        "--output-dir",
        unresolvedRoot,
      ],
      code: "skill_unresolved",
    },
  ] as const;
  for (const entry of cases) {
    const result = await runCommand(entry.args, { cwd: repositoryRoot, env: environment });
    requireCondition(result.exitCode === 2, `invalid_cli_exit:${entry.code}`);
    requireCondition(result.stdout === "", `invalid_cli_stdout:${entry.code}`);
    requireCondition(result.stderr.includes(`: ${entry.code}:`), `invalid_cli_code:${entry.code}`);
  }
  requireCondition(!existsSync(unresolvedRoot), "invalid_cli_created_runtime");
  const missingDatabase = join(temporaryRoot, "missing.sqlite");
  const report = await runCommand(
    ["bun", "run", "cli", "--", "report", "--db", missingDatabase, "--format", "json"],
    { cwd: repositoryRoot, env: environment },
  );
  requireCondition(report.exitCode === 2 && report.stdout === "", "invalid_report_contract");
  requireCondition(!existsSync(missingDatabase), "invalid_report_created_database");
  const replay = await runCommand(
    ["bun", "run", "cli", "--", "replay", join(temporaryRoot, "missing.jsonl"), "--format", "tui"],
    { cwd: repositoryRoot, env: environment },
  );
  requireCondition(replay.exitCode === 2 && replay.stdout === "", "invalid_tui_contract");
  requireCondition(replay.stderr.includes(": unsupported_argument:"), "invalid_tui_code");
}

export async function verifyPipedCliOutput(temporaryRoot: string): Promise<void> {
  const environment = createNoKeyEnvironment(temporaryRoot);
  const help = await runSuccessfulCommand(
    ["bun", "run", "cli", "--", "--help"],
    { cwd: repositoryRoot, env: environment },
    "piped_help_failed",
  );
  requireNoTerminalEscapes(help.stdout, "piped_help_escape");
  const list = await runSuccessfulCommand(
    ["bun", "run", "cli", "--", "list", "scenarios"],
    { cwd: repositoryRoot, env: environment },
    "piped_list_failed",
  );
  requireNoTerminalEscapes(list.stdout, "piped_list_escape");
  const runtime = join(temporaryRoot, "runtime");
  const run = await runSuccessfulCommand(
    [
      "bun",
      "run",
      "cli",
      "--",
      "run",
      "--mock",
      "--scenario",
      "git-worktrees",
      "--skill",
      "tdd",
      "--model",
      "gpt-4o",
      "--output-dir",
      runtime,
    ],
    { cwd: repositoryRoot, env: environment },
    "piped_run_failed",
  );
  requireNoTerminalEscapes(run.stdout, "piped_run_escape");
  const report = await runSuccessfulCommand(
    [
      "bun",
      "run",
      "cli",
      "--",
      "report",
      "--db",
      join(runtime, "db", "benchmarks.sqlite"),
      "--format",
      "json",
    ],
    { cwd: repositoryRoot, env: environment },
    "piped_report_failed",
  );
  requireNoTerminalEscapes(report.stdout, "piped_report_escape");
  const snapshot = parseJsonRecord(report.stdout, "piped_report_json_invalid");
  requireCondition(snapshot.eligibleRunCount === 0, "piped_report_authority_invalid");
}

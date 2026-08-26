import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyCiDiagnostic } from "../verify-ci-diagnostic.js";
import { requireCondition, readJsonRecord } from "./assertions.js";
import { runSuccessfulCommand } from "./command.js";
import { createNoKeyEnvironment, repositoryRoot } from "./fixture.js";

export async function verifyNoKeyFakeRun(temporaryRoot: string): Promise<void> {
  const runtime = join(temporaryRoot, "runtime");
  const result = await runFake(runtime, temporaryRoot);
  requireCondition(result.stdout.includes("[ COMPLETE ]"), "fake_run_terminal_missing");
  requireCondition(!result.stdout.includes("PASS"), "fake_run_pass_claim_present");
  const runDirectories = readdirSync(join(runtime, "runs"));
  requireCondition(
    runDirectories.length === 1 && runDirectories[0] !== undefined,
    "fake_run_missing",
  );
  const runDirectory = join(runtime, "runs", runDirectories[0]);
  const manifest = readJsonRecord(join(runDirectory, "manifest.json"), "fake_manifest_invalid");
  const terminal = readJsonRecord(join(runDirectory, "result.json"), "fake_result_invalid");
  requireCondition(
    manifest.executionMode === "fake" && manifest.simulated === true,
    "fake_manifest_mode_invalid",
  );
  requireCondition(
    terminal.status === "completed" && terminal.simulated === true,
    "fake_result_status_invalid",
  );
  requireCondition(!Object.hasOwn(terminal, "passedBenchmark"), "fake_result_pass_claim_present");
}

export async function verifyArtifactReconciliation(temporaryRoot: string): Promise<void> {
  const bundle = join(temporaryRoot, "bundle");
  const runtime = join(bundle, "runtime");
  const logs = join(bundle, "logs");
  mkdirSync(logs, { recursive: true });
  const run = await runFake(runtime, temporaryRoot);
  writeFileSync(join(logs, "run.log"), run.stdout);
  await runSuccessfulCommand(
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
      "--output",
      join(runtime, "exports", "diagnostic-report.json"),
    ],
    { cwd: repositoryRoot, env: createNoKeyEnvironment(temporaryRoot) },
    "artifact_report_failed",
  );
  verifyCiDiagnostic([bundle]);
}

async function runFake(runtime: string, temporaryRoot: string) {
  return runSuccessfulCommand(
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
    { cwd: repositoryRoot, env: createNoKeyEnvironment(temporaryRoot) },
    "fake_run_failed",
  );
}

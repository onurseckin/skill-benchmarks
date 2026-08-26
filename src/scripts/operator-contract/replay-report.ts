import { existsSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { parseJsonRecord, requireCondition, readJsonRecord } from "./assertions.js";
import { runCommand, runSuccessfulCommand } from "./command.js";
import { createNoKeyEnvironment, repositoryRoot } from "./fixture.js";

export async function verifyReplayRoundTrip(temporaryRoot: string): Promise<void> {
  const runtime = join(temporaryRoot, "runtime");
  const environment = createNoKeyEnvironment(temporaryRoot);
  await runFixture(runtime, environment);
  const runId = requireSingleEntry(join(runtime, "runs"), "replay_run_missing");
  const events = join(runtime, "runs", runId, "events.jsonl");
  const direct = await runSuccessfulCommand(
    ["bun", "run", "cli", "--", "replay", events, "--format", "json"],
    { cwd: repositoryRoot, env: environment },
    "replay_direct_failed",
  );
  const directSession = parseJsonRecord(direct.stdout, "replay_direct_json_invalid");
  const directProvenance = directSession.provenance as Record<string, unknown>;
  requireCondition(directProvenance.sourceKind === "direct", "replay_direct_provenance_invalid");
  const canonicalExport = join(temporaryRoot, "canonical-replay.json");
  const canonical = await runSuccessfulCommand(
    [
      "bun",
      "run",
      "cli",
      "--",
      "replay",
      "--run-id",
      runId,
      "--db",
      join(runtime, "db", "benchmarks.sqlite"),
      "--output-dir",
      runtime,
      "--format",
      "json",
      "--output",
      canonicalExport,
    ],
    { cwd: repositoryRoot, env: environment },
    "replay_canonical_failed",
  );
  requireCondition(canonical.stdout === "", "replay_canonical_stdout_invalid");
  const canonicalSession = readJsonRecord(canonicalExport, "replay_canonical_json_invalid");
  const canonicalProvenance = canonicalSession.provenance as Record<string, unknown>;
  requireCondition(
    canonicalProvenance.sourceKind === "canonical-run",
    "replay_canonical_provenance_invalid",
  );
  requireCondition(canonicalSession.metadata !== undefined, "replay_canonical_metadata_missing");
  const roundTrip = await runSuccessfulCommand(
    ["bun", "run", "cli", "--", "replay", canonicalExport, "--format", "json"],
    { cwd: repositoryRoot, env: environment },
    "replay_round_trip_failed",
  );
  const roundTripSession = parseJsonRecord(roundTrip.stdout, "replay_round_trip_json_invalid");
  requireCondition(
    JSON.stringify(roundTripSession.frames) === JSON.stringify(canonicalSession.frames),
    "replay_round_trip_frames_changed",
  );
  await verifySymlinkRejection(runtime, runId, temporaryRoot, environment);
}

export async function verifyReportCohorts(temporaryRoot: string): Promise<void> {
  const runtime = join(temporaryRoot, "runtime");
  const environment = createNoKeyEnvironment(temporaryRoot);
  await runFixture(runtime, environment);
  const database = join(runtime, "db", "benchmarks.sqlite");
  const report = await runSuccessfulCommand(
    [
      "bun",
      "run",
      "cli",
      "--",
      "report",
      "--db",
      database,
      "--format",
      "json",
      "--scenario",
      "git-worktrees",
      "--category",
      "coding",
      "--skill",
      "tdd",
      "--model",
      "gpt-4o",
      "--provider",
      "openai",
      "--status",
      "completed",
      "--execution-mode",
      "fake",
      "--simulated",
      "true",
      "--authority",
      "diagnostic",
      "--cohort",
      "validation",
      "--eligibility",
      "ineligible",
      "--evaluation-status",
      "not_evaluated",
      "--evidence-status",
      "unavailable",
      "--from-date",
      "2000-01-01T00:00:00.000Z",
      "--to-date",
      "2999-01-01T00:00:00.000Z",
    ],
    { cwd: repositoryRoot, env: environment },
    "report_filter_failed",
  );
  const snapshot = parseJsonRecord(report.stdout, "report_filter_json_invalid");
  requireCondition(snapshot.matchedRunCount === 1, "report_filter_match_invalid");
  requireCondition(snapshot.eligibleRunCount === 0, "report_filter_eligible_invalid");
  requireCondition(snapshot.diagnosticRunCount === 1, "report_filter_diagnostic_invalid");
  requireCondition(
    Array.isArray(snapshot.leaderboard) && snapshot.leaderboard.length === 0,
    "report_rank_claim_present",
  );
  const consoleReport = await runSuccessfulCommand(
    ["bun", "run", "cli", "--", "report", "--db", database],
    { cwd: repositoryRoot, env: environment },
    "report_console_failed",
  );
  requireCondition(
    consoleReport.stdout.includes("SIMULATED / UNRANKED"),
    "report_console_provenance_missing",
  );
  requireCondition(
    consoleReport.stdout.includes("NO ELIGIBLE BENCHMARK EVIDENCE"),
    "report_console_empty_state_missing",
  );
  const noMatch = await runSuccessfulCommand(
    [
      "bun",
      "run",
      "cli",
      "--",
      "report",
      "--db",
      database,
      "--format",
      "json",
      "--authority",
      "eligible",
    ],
    { cwd: repositoryRoot, env: environment },
    "report_eligible_filter_failed",
  );
  const emptySnapshot = parseJsonRecord(noMatch.stdout, "report_eligible_json_invalid");
  requireCondition(emptySnapshot.matchedRunCount === 0, "report_eligible_match_invalid");
}

async function runFixture(
  runtime: string,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  await runSuccessfulCommand(
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
    "replay_report_fixture_failed",
  );
}

async function verifySymlinkRejection(
  runtime: string,
  runId: string,
  temporaryRoot: string,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const runDirectory = join(runtime, "runs", runId);
  const manifest = join(runDirectory, "manifest.json");
  const manifestCopy = join(temporaryRoot, "manifest-copy.json");
  const manifestValue = Bun.file(manifest);
  await Bun.write(manifestCopy, manifestValue);
  rmSync(manifest);
  symlinkSync(manifestCopy, manifest);
  const output = join(temporaryRoot, "rejected.json");
  const result = await runCommand(
    [
      "bun",
      "run",
      "cli",
      "--",
      "replay",
      "--run-id",
      runId,
      "--db",
      join(runtime, "db", "benchmarks.sqlite"),
      "--output-dir",
      runtime,
      "--format",
      "json",
      "--output",
      output,
    ],
    { cwd: repositoryRoot, env: environment },
  );
  requireCondition(result.exitCode === 2 && result.stdout === "", "replay_symlink_accepted");
  requireCondition(!existsSync(output), "replay_symlink_output_created");
}

function requireSingleEntry(path: string, code: string): string {
  const entries = readdirSync(path);
  requireCondition(entries.length === 1 && entries[0] !== undefined, code);
  return entries[0];
}

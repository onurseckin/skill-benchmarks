import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DiagnosticVerificationError, failVerification, requireCondition } from "./assertions.js";

export interface DiagnosticBundlePaths {
  readonly bundle: string;
  readonly log: string;
  readonly database: string;
  readonly report: string;
  readonly runDirectory: string;
  readonly events: string;
  readonly manifest: string;
  readonly result: string;
  readonly sweepDirectory: string;
  readonly plan: string;
  readonly checkpoint: string;
  readonly outcome: string;
}

const unsafeFilePatterns = [
  /-wal$/,
  /-shm$/,
  /\.tmp$/,
  /^\.manifest\.json\..*\.tmp$/,
  /^\.result\.json\..*\.tmp$/,
  /^\.terminal-failure\.json\..*\.tmp$/,
  /^\.checkpoint\.json\..*\.tmp$/,
  /^\.outcome\.json\..*\.tmp$/,
] as const;

function readEntries(path: string): readonly string[] {
  try {
    return readdirSync(path).sort();
  } catch {
    return failVerification("filesystem_directory_unreadable");
  }
}

function requireExactEntries(path: string, expected: readonly string[], code: string): void {
  const actual = readEntries(path);
  requireCondition(
    actual.length === expected.length && actual.every((entry, index) => entry === expected[index]),
    code,
  );
}

function requireAllowedEntries(
  path: string,
  required: readonly string[],
  allowed: readonly string[],
  code: string,
): readonly string[] {
  const actual = readEntries(path);
  const allowedSet = new Set(allowed);
  requireCondition(
    required.every((entry) => actual.includes(entry)) &&
      actual.every((entry) => allowedSet.has(entry)),
    code,
  );
  return actual;
}

function requireDirectory(path: string, bundle: string, code: string): void {
  try {
    const stats = lstatSync(path);
    requireCondition(stats.isDirectory() && !stats.isSymbolicLink() && stats.nlink >= 1, code);
    requireContainedRealPath(path, bundle, code);
  } catch (error) {
    if (error instanceof DiagnosticVerificationError) throw error;
    failVerification(code);
  }
}

function requireFile(path: string, bundle: string, nonempty: boolean, code: string): void {
  try {
    const stats = lstatSync(path);
    requireCondition(stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1, code);
    requireCondition(!nonempty || stats.size > 0, code);
    requireContainedRealPath(path, bundle, code);
  } catch (error) {
    if (error instanceof DiagnosticVerificationError) throw error;
    failVerification(code);
  }
}

function requireContainedRealPath(path: string, bundle: string, code: string): void {
  const real = realpathSync(path);
  const child = relative(bundle, real);
  requireCondition(child === "" || (!child.startsWith("..") && !isAbsolute(child)), code);
}

function scanTree(path: string, bundle: string): void {
  for (const entry of readEntries(path)) {
    const child = join(path, entry);
    const stats = lstatSync(child);
    requireCondition(!stats.isSymbolicLink(), "filesystem_symlink_rejected");
    requireCondition(
      stats.isDirectory() || (stats.isFile() && stats.nlink === 1),
      "filesystem_node_rejected",
    );
    requireCondition(
      !unsafeFilePatterns.some((pattern) => pattern.test(entry)),
      "filesystem_temporary_rejected",
    );
    requireContainedRealPath(child, bundle, "filesystem_escape_rejected");
    if (stats.isDirectory()) scanTree(child, bundle);
  }
}

function requireSingleDirectory(path: string, bundle: string, code: string): string {
  const entries = readEntries(path);
  requireCondition(entries.length === 1, code);
  const directory = join(path, entries[0] ?? "");
  requireDirectory(directory, bundle, code);
  return directory;
}

export function validateDiagnosticBundleFilesystem(argument: string): DiagnosticBundlePaths {
  const unresolvedBundle = resolve(argument);
  let bundle: string;
  try {
    const stats = lstatSync(unresolvedBundle);
    requireCondition(stats.isDirectory() && !stats.isSymbolicLink(), "filesystem_bundle_rejected");
    bundle = realpathSync(unresolvedBundle);
  } catch (error) {
    if (error instanceof DiagnosticVerificationError) throw error;
    return failVerification("filesystem_bundle_rejected");
  }
  const logs = join(bundle, "logs");
  const runtime = join(bundle, "runtime");
  const databaseDirectory = join(runtime, "db");
  const exportsDirectory = join(runtime, "exports");
  const runsDirectory = join(runtime, "runs");
  const sweepsDirectory = join(runtime, "sweeps");
  requireDirectory(logs, bundle, "filesystem_logs_rejected");
  requireDirectory(runtime, bundle, "filesystem_runtime_rejected");
  requireDirectory(databaseDirectory, bundle, "filesystem_database_directory_rejected");
  requireDirectory(exportsDirectory, bundle, "filesystem_exports_rejected");
  requireDirectory(runsDirectory, bundle, "filesystem_runs_rejected");
  requireDirectory(sweepsDirectory, bundle, "filesystem_sweeps_rejected");
  requireExactEntries(bundle, ["logs", "runtime"], "filesystem_bundle_shape_invalid");
  requireExactEntries(
    runtime,
    ["db", "exports", "runs", "sweeps"],
    "filesystem_runtime_shape_invalid",
  );
  requireExactEntries(logs, ["run.log"], "filesystem_logs_shape_invalid");
  requireExactEntries(
    databaseDirectory,
    ["benchmarks.sqlite"],
    "filesystem_database_shape_invalid",
  );
  requireExactEntries(
    exportsDirectory,
    ["diagnostic-report.json"],
    "filesystem_exports_shape_invalid",
  );
  const runDirectory = requireSingleDirectory(
    runsDirectory,
    bundle,
    "filesystem_run_count_invalid",
  );
  const sweepDirectory = requireSingleDirectory(
    sweepsDirectory,
    bundle,
    "filesystem_sweep_count_invalid",
  );
  const runEntries = requireAllowedEntries(
    runDirectory,
    ["events.jsonl", "manifest.json", "result.json"],
    ["events.jsonl", "manifest.json", "raw.log", "result.json"],
    "filesystem_run_shape_invalid",
  );
  requireExactEntries(
    sweepDirectory,
    ["checkpoint.json", "outcome.json", "plan.json"],
    "filesystem_sweep_shape_invalid",
  );
  const paths: DiagnosticBundlePaths = {
    bundle,
    log: join(logs, "run.log"),
    database: join(databaseDirectory, "benchmarks.sqlite"),
    report: join(exportsDirectory, "diagnostic-report.json"),
    runDirectory,
    events: join(runDirectory, "events.jsonl"),
    manifest: join(runDirectory, "manifest.json"),
    result: join(runDirectory, "result.json"),
    sweepDirectory,
    plan: join(sweepDirectory, "plan.json"),
    checkpoint: join(sweepDirectory, "checkpoint.json"),
    outcome: join(sweepDirectory, "outcome.json"),
  };
  requireFile(paths.log, bundle, true, "filesystem_log_invalid");
  requireFile(paths.database, bundle, true, "filesystem_database_invalid");
  requireFile(paths.report, bundle, true, "filesystem_report_invalid");
  requireFile(paths.events, bundle, true, "filesystem_events_invalid");
  requireFile(paths.manifest, bundle, true, "filesystem_manifest_invalid");
  requireFile(paths.result, bundle, true, "filesystem_result_invalid");
  if (runEntries.includes("raw.log")) {
    const rawLog = join(runDirectory, "raw.log");
    requireFile(rawLog, bundle, false, "filesystem_raw_log_invalid");
    requireCondition(lstatSync(rawLog).size === 0, "filesystem_raw_log_invalid");
  }
  requireFile(paths.plan, bundle, true, "filesystem_plan_invalid");
  requireFile(paths.checkpoint, bundle, true, "filesystem_checkpoint_invalid");
  requireFile(paths.outcome, bundle, true, "filesystem_outcome_invalid");
  scanTree(bundle, bundle);
  return paths;
}

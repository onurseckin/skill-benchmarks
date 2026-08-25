import { lstat, mkdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { RunArtifactDirectoryIdentity, RunArtifactLayout } from "./types.js";

const outputRootDirectories = ["db", "runs", "sweeps", "exports"] as const;

function requirePathSegment(value: string, label: string): void {
  if (value.trim().length === 0 || value === "." || value === ".." || value.includes("/") || value.includes("\\")) {
    throw new TypeError(`${label} must be a non-empty path segment`);
  }
}

export function createRunArtifactLayout(
  outputRoot: string,
  runId: string
): RunArtifactLayout {
  requirePathSegment(runId, "Run ID");
  const resolvedOutputRoot = resolve(outputRoot);
  const runDirectory = join(resolvedOutputRoot, "runs", runId);

  return {
    outputRoot: resolvedOutputRoot,
    runDirectory,
    manifestPath: join(runDirectory, "manifest.json"),
    eventsPath: join(runDirectory, "events.jsonl"),
    transcriptPath: join(runDirectory, "transcript.jsonl"),
    rawLogPath: join(runDirectory, "raw.log"),
    metricsPath: join(runDirectory, "metrics.json"),
    evaluationPath: join(runDirectory, "evaluation.json"),
    gitDiffPath: join(runDirectory, "git.diff"),
    diffManifestPath: join(runDirectory, "diff-manifest.json"),
    resultPath: join(runDirectory, "result.json"),
    terminalFailurePath: join(runDirectory, "terminal-failure.json"),
  };
}

export async function prepareRunArtifactLayout(
  layout: RunArtifactLayout
): Promise<RunArtifactLayout> {
  await ensureArtifactDirectory(layout.outputRoot, true);
  await assertNoSymlinkComponents(layout.outputRoot, layout.runDirectory);
  for (const directory of outputRootDirectories) {
    await ensureArtifactDirectory(join(layout.outputRoot, directory));
  }
  await ensureArtifactDirectory(layout.runDirectory);
  await assertNoSymlinkComponents(layout.outputRoot, layout.runDirectory);
  const runsDirectory = join(layout.outputRoot, "runs");
  return {
    ...layout,
    authority: {
      outputRoot: await inspectArtifactDirectory(layout.outputRoot),
      runsDirectory: await inspectArtifactDirectory(runsDirectory),
      runDirectory: await inspectArtifactDirectory(layout.runDirectory),
    },
  };
}

async function ensureArtifactDirectory(path: string, recursive: boolean = true): Promise<void> {
  await mkdir(path, { recursive });
  const stats = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new TypeError("Benchmark artifact directory is unsafe");
}

async function inspectArtifactDirectory(path: string): Promise<RunArtifactDirectoryIdentity> {
  const stats = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new TypeError("Benchmark artifact directory is unsafe");
  return { device: stats.dev, inode: stats.ino };
}

async function assertNoSymlinkComponents(rootPath: string, targetPath: string): Promise<void> {
  const resolvedRoot = resolve(rootPath);
  const relativeTarget = relative(resolvedRoot, resolve(targetPath));
  if (relativeTarget === ".." || relativeTarget.startsWith("../")) throw new TypeError("Benchmark artifact path is unsafe");
  const segments = relativeTarget.split(/[\\/]+/).filter(Boolean);
  let currentPath = resolvedRoot;
  const rootStats = await lstat(currentPath);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new TypeError("Benchmark artifact path is unsafe");
  for (const segment of segments) {
    currentPath = join(currentPath, segment);
    try {
      if ((await lstat(currentPath)).isSymbolicLink()) throw new TypeError("Benchmark artifact path is unsafe");
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

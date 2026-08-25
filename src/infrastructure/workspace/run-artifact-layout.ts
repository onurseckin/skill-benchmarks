import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RunArtifactLayout } from "./types.js";

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
  };
}

export async function prepareRunArtifactLayout(
  layout: RunArtifactLayout
): Promise<RunArtifactLayout> {
  await Promise.all([
    ...outputRootDirectories.map((directory) => mkdir(join(layout.outputRoot, directory), { recursive: true })),
    mkdir(layout.runDirectory, { recursive: true }),
  ]);
  return layout;
}

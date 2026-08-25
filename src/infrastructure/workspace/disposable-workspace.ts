import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { Stats } from "node:fs";
import { createRunArtifactLayout } from "./run-artifact-layout.js";
import type { DisposableWorkspace } from "./types.js";

export interface DisposableWorkspaceInput {
  readonly outputRoot: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly fixtures: Readonly<Record<string, string>>;
}

interface FixtureWrite {
  readonly relativePath: string;
  readonly targetPath: string;
  readonly content: string;
}

function requireScenarioId(scenarioId: string): void {
  if (scenarioId.trim().length === 0) {
    throw new TypeError("Scenario ID must not be empty");
  }
}

export function resolveDisposableWorkspacePath(
  rootPath: string,
  relativePath: string
): string {
  if (relativePath.trim().length === 0) {
    throw new TypeError("Fixture path must not be empty");
  }
  const resolvedRootPath = resolve(rootPath);
  const resolvedPath = resolve(resolvedRootPath, relativePath);
  const relativePathFromRoot = relative(resolvedRootPath, resolvedPath);
  if (relativePathFromRoot === "" || relativePathFromRoot === ".." || relativePathFromRoot.startsWith("../")) {
    throw new Error(`Path traversal denied: '${relativePath}' escapes disposable workspace`);
  }
  return resolvedPath;
}

function resolveFixturePaths(
  rootPath: string,
  fixtures: Readonly<Record<string, string>>
): ReadonlyArray<FixtureWrite> {
  return Object.entries(fixtures).map(([relativePath, content]) => {
    if (typeof content !== "string") {
      throw new TypeError(`Fixture '${relativePath}' must contain string content`);
    }
    return {
      relativePath,
      targetPath: resolveDisposableWorkspacePath(rootPath, relativePath),
      content,
    };
  });
}

async function getPathStats(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function requireSafeDirectory(path: string, stats: Stats): void {
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Unsafe workspace directory path: '${path}'`);
  }
}

async function ensureSafeDirectory(path: string, recursive: boolean = false): Promise<void> {
  let stats = await getPathStats(path);
  if (stats === undefined) {
    try {
      await mkdir(path, { recursive });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
    stats = await getPathStats(path);
  }
  if (stats === undefined) {
    throw new Error(`Workspace directory was not created: '${path}'`);
  }
  requireSafeDirectory(path, stats);
}

async function ensureSafeWorkspaceRoot(
  outputRoot: string,
  runId: string
): Promise<string> {
  const resolvedOutputRoot = resolve(outputRoot);
  await ensureSafeDirectory(resolvedOutputRoot, true);
  const runsDirectory = resolve(resolvedOutputRoot, "runs");
  await ensureSafeDirectory(runsDirectory);
  const runDirectory = resolve(runsDirectory, runId);
  await ensureSafeDirectory(runDirectory);
  const workspaceDirectory = resolve(runDirectory, "workspace");
  await ensureSafeDirectory(workspaceDirectory);
  return workspaceDirectory;
}

async function ensureSafeFixtureParentDirectories(
  rootPath: string,
  relativePath: string
): Promise<void> {
  const pathSegments = relativePath.split(/[\\/]+/).slice(0, -1);
  let directoryPath = rootPath;
  for (const pathSegment of pathSegments) {
    directoryPath = resolve(directoryPath, pathSegment);
    await ensureSafeDirectory(directoryPath);
  }
}

async function ensureSafeFixtureDestination(path: string): Promise<void> {
  const stats = await getPathStats(path);
  if (stats !== undefined && (stats.isSymbolicLink() || !stats.isFile())) {
    throw new Error(`Unsafe workspace fixture path: '${path}'`);
  }
}

export async function createDisposableWorkspace(
  input: DisposableWorkspaceInput
): Promise<DisposableWorkspace> {
  requireScenarioId(input.scenarioId);
  const artifactLayout = createRunArtifactLayout(input.outputRoot, input.runId);
  const rootPath = resolve(artifactLayout.runDirectory, "workspace");
  const fixturePaths = resolveFixturePaths(rootPath, input.fixtures);

  const verifiedRootPath = await ensureSafeWorkspaceRoot(artifactLayout.outputRoot, input.runId);
  for (const fixture of fixturePaths) {
    await ensureSafeFixtureParentDirectories(verifiedRootPath, fixture.relativePath);
    await ensureSafeFixtureDestination(fixture.targetPath);
    await writeFile(fixture.targetPath, fixture.content, "utf8");
  }

  return {
    rootPath: verifiedRootPath,
    async dispose(): Promise<void> {
      await rm(verifiedRootPath, { recursive: true, force: true });
    },
  };
}

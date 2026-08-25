import { mkdir, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { createRunArtifactLayout } from "./run-artifact-layout.js";
import type { DisposableWorkspace } from "./types.js";

export interface DisposableWorkspaceInput {
  readonly outputRoot: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly fixtures: Readonly<Record<string, string>>;
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
): ReadonlyArray<readonly [string, string]> {
  return Object.entries(fixtures).map(([relativePath, content]) => {
    if (typeof content !== "string") {
      throw new TypeError(`Fixture '${relativePath}' must contain string content`);
    }
    return [resolveDisposableWorkspacePath(rootPath, relativePath), content] as const;
  });
}

export async function createDisposableWorkspace(
  input: DisposableWorkspaceInput
): Promise<DisposableWorkspace> {
  requireScenarioId(input.scenarioId);
  const artifactLayout = createRunArtifactLayout(input.outputRoot, input.runId);
  const rootPath = resolve(artifactLayout.runDirectory, "workspace");
  const fixturePaths = resolveFixturePaths(rootPath, input.fixtures);

  await mkdir(rootPath, { recursive: true });
  for (const [fixturePath, content] of fixturePaths) {
    await mkdir(resolve(fixturePath, ".."), { recursive: true });
    await writeFile(fixturePath, content, "utf8");
  }

  return {
    rootPath,
    async dispose(): Promise<void> {
      await rm(rootPath, { recursive: true, force: true });
    },
  };
}

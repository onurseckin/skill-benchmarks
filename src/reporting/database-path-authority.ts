import { closeSync, constants, fstatSync, lstatSync, openSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

export function validateDatabasePathBeforeOpen(databasePath: string, authorityRoot?: string): void {
  if (databasePath === ":memory:") return;
  const resolvedDatabasePath = resolve(databasePath);
  const databaseDirectory = dirname(resolvedDatabasePath);
  const structuredRoot =
    authorityRoot === undefined && basename(databaseDirectory) === "db"
      ? dirname(databaseDirectory)
      : resolve(authorityRoot ?? databaseDirectory);
  validateDatabaseDirectory(structuredRoot, databaseDirectory);
  let targetStats;
  try {
    targetStats = lstatSync(resolvedDatabasePath);
  } catch (error) {
    if (isMissingPath(error)) return;
    throw unsafeDatabasePath();
  }
  if (!targetStats.isFile() || targetStats.isSymbolicLink() || targetStats.nlink !== 1) {
    throw unsafeDatabasePath();
  }
  let descriptor: number;
  try {
    descriptor = openSync(
      resolvedDatabasePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    throw unsafeDatabasePath();
  }
  try {
    const descriptorStats = fstatSync(descriptor);
    if (
      !descriptorStats.isFile() ||
      descriptorStats.nlink !== 1 ||
      descriptorStats.dev !== targetStats.dev ||
      descriptorStats.ino !== targetStats.ino
    ) {
      throw unsafeDatabasePath();
    }
  } finally {
    closeSync(descriptor);
  }
}

function validateDatabaseDirectory(authorityRoot: string, databaseDirectory: string): void {
  const relativeDirectory = relative(authorityRoot, databaseDirectory);
  if (relativeDirectory === ".." || relativeDirectory.startsWith("../")) throw unsafeDatabasePath();
  const rootStats = lstatSync(authorityRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw unsafeDatabasePath();
  let currentDirectory = authorityRoot;
  for (const segment of relativeDirectory.split(/[\\/]+/).filter(Boolean)) {
    currentDirectory = join(currentDirectory, segment);
    const value = lstatSync(currentDirectory);
    if (!value.isDirectory() || value.isSymbolicLink()) throw unsafeDatabasePath();
  }
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function unsafeDatabasePath(): TypeError {
  return new TypeError("Benchmark database path is unsafe");
}

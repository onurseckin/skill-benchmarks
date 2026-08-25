import { closeSync, constants, fstatSync, lstatSync, openSync } from "node:fs";
import { join } from "node:path";
import type { RunArtifactDirectoryIdentity, RunArtifactLayout } from "./types.js";

export function openAuthorizedRunDirectory(layout: RunArtifactLayout): number {
  requireRunArtifactAuthority(layout);
  const descriptor = openRetainedDirectory(layout.runDirectory);
  try {
    requireDirectoryIdentity(fstatSync(descriptor), requireAuthority(layout).runDirectory);
    requireRunArtifactAuthority(layout);
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

export function openRetainedDirectory(path: string): number {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isDirectory()) throw new TypeError("Benchmark artifact directory is unsafe");
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

export function inspectDirectoryDescriptor(descriptor: number): RunArtifactDirectoryIdentity {
  const stats = fstatSync(descriptor);
  if (!stats.isDirectory()) throw new TypeError("Benchmark artifact directory is unsafe");
  return { device: stats.dev, inode: stats.ino };
}

export function requireRetainedDirectoryPath(path: string, expected: RunArtifactDirectoryIdentity): void {
  requireDirectoryIdentity(lstatSync(path), expected);
}

export function requireRunArtifactAuthority(layout: RunArtifactLayout): void {
  const authority = requireAuthority(layout);
  requireDirectoryIdentity(lstatSync(layout.outputRoot), authority.outputRoot);
  requireDirectoryIdentity(lstatSync(join(layout.outputRoot, "runs")), authority.runsDirectory);
  requireDirectoryIdentity(lstatSync(layout.runDirectory), authority.runDirectory);
}

function requireAuthority(layout: RunArtifactLayout): NonNullable<RunArtifactLayout["authority"]> {
  if (layout.authority === undefined) throw new TypeError("Benchmark artifact directory authority is missing");
  return layout.authority;
}

function requireDirectoryIdentity(
  stats: { isDirectory(): boolean; isSymbolicLink(): boolean; dev: number; ino: number },
  expected: RunArtifactDirectoryIdentity
): void {
  if (!stats.isDirectory() || stats.isSymbolicLink() || stats.dev !== expected.device || stats.ino !== expected.inode) {
    throw new TypeError("Benchmark artifact directory is unsafe");
  }
}

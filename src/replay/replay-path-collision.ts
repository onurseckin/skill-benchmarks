import { lstatSync, statSync } from "node:fs";
import { resolve } from "node:path";

interface FileIdentity {
  readonly device: number;
  readonly inode: number;
}

export function requireDistinctReplayOutput(
  outputPath: string | undefined,
  protectedPaths: readonly string[]
): void {
  if (outputPath === undefined) return;
  const resolvedOutput = resolve(outputPath);
  const outputIdentities = inspectPathIdentities(resolvedOutput);
  for (const protectedPath of protectedPaths) {
    const resolvedProtected = resolve(protectedPath);
    if (resolvedOutput === resolvedProtected) throw new TypeError("Replay input and output must differ");
    const protectedIdentities = inspectPathIdentities(resolvedProtected);
    if (outputIdentities.some((output) => protectedIdentities.some((source) => sameIdentity(output, source)))) {
      throw new TypeError("Replay input and output must differ");
    }
  }
}

function inspectPathIdentities(path: string): readonly FileIdentity[] {
  const identities: FileIdentity[] = [];
  const direct = inspectIdentity(path, false);
  if (direct !== undefined) identities.push(direct);
  const followed = inspectIdentity(path, true);
  if (followed !== undefined && !identities.some((value) => sameIdentity(value, followed))) identities.push(followed);
  return identities;
}

function inspectIdentity(path: string, follow: boolean): FileIdentity | undefined {
  try {
    const stats = follow ? statSync(path) : lstatSync(path);
    return { device: stats.dev, inode: stats.ino };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new TypeError("Replay path identity is unavailable");
  }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

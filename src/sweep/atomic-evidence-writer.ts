import { randomUUID } from "node:crypto";
import { closeSync, constants, fchmodSync, fsyncSync, fstatSync, lstatSync, openSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type {
  RunArtifactDirectoryIdentity,
  RunArtifactLayout,
} from "../infrastructure/workspace/types.js";
import { sanitizeBenchmarkArtifactValue } from "../shared/artifact-sanitization.js";
import { linkDirectoryEntry, openDirectoryEntry, unlinkDirectoryEntry } from "./directory-entry-operations.js";

interface FileIdentity {
  readonly device: number;
  readonly inode: number;
}

type EvidenceSyncPhase = "payload" | "publication" | "cleanup";

export interface EvidenceSyncOperations {
  syncDescriptor(descriptor: number, phase: EvidenceSyncPhase): void;
}

const durableEvidenceSync: EvidenceSyncOperations = {
  syncDescriptor(descriptor): void {
    fsyncSync(descriptor);
  },
};

export class EvidenceCommitError extends Error {
  public readonly targetCommitted: boolean;

  public constructor(targetCommitted: boolean) {
    super("terminal evidence persistence failed");
    this.name = "EvidenceCommitError";
    this.targetCommitted = targetCommitted;
  }
}

export async function writeAtomicEvidenceJson(
  layout: RunArtifactLayout,
  path: string,
  value: unknown,
  syncOperations: EvidenceSyncOperations = durableEvidenceSync
): Promise<void> {
  commitEvidence(layout, path, value, syncOperations);
}

export function commitAtomicEvidenceJson(
  layout: RunArtifactLayout,
  path: string,
  value: unknown,
  syncOperations: EvidenceSyncOperations = durableEvidenceSync
): void {
  commitEvidence(layout, path, value, syncOperations);
}

export function removeAtomicEvidence(layout: RunArtifactLayout, path: string): void {
  const directoryDescriptor = openAuthorizedArtifactDirectory(layout, path);
  const targetName = basename(path);
  let targetDescriptor: number | undefined;
  try {
    targetDescriptor = openDirectoryEntry(
      directoryDescriptor,
      targetName,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    const targetStats = fstatSync(targetDescriptor);
    if (!targetStats.isFile() || targetStats.nlink !== 1) throw new EvidenceCommitError(true);
    closeSync(targetDescriptor);
    targetDescriptor = undefined;
    unlinkDirectoryEntry(directoryDescriptor, targetName);
    fsyncSync(directoryDescriptor);
    requireArtifactDirectoryAuthority(layout);
  } catch {
    throw new EvidenceCommitError(true);
  } finally {
    if (targetDescriptor !== undefined) closeSync(targetDescriptor);
    closeSync(directoryDescriptor);
  }
}

function commitEvidence(
  layout: RunArtifactLayout,
  path: string,
  value: unknown,
  syncOperations: EvidenceSyncOperations
): void {
  const directoryDescriptor = openAuthorizedArtifactDirectory(layout, path);
  const targetName = basename(path);
  const temporaryName = `.${targetName}.${randomUUID()}.tmp`;
  let temporaryDescriptor: number | undefined;
  let temporaryIdentity: FileIdentity | undefined;
  let targetCommitted = false;
  let temporaryExists = false;
  try {
    temporaryDescriptor = openDirectoryEntry(
      directoryDescriptor,
      temporaryName,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600
    );
    temporaryExists = true;
    fchmodSync(temporaryDescriptor, 0o600);
    temporaryIdentity = descriptorIdentity(temporaryDescriptor);
    writeFileSync(temporaryDescriptor, serializeEvidence(value), "utf8");
    syncOperations.syncDescriptor(temporaryDescriptor, "payload");
    assertOwnedDirectoryEntry(directoryDescriptor, temporaryName, temporaryIdentity, 1, 1);
    requireArtifactDirectoryAuthority(layout);
    linkDirectoryEntry(directoryDescriptor, temporaryName, targetName);
    targetCommitted = true;
    assertOwnedDirectoryEntry(directoryDescriptor, targetName, temporaryIdentity, 2, 2);
    syncOperations.syncDescriptor(directoryDescriptor, "publication");
    requireArtifactDirectoryAuthority(layout);
    unlinkDirectoryEntry(directoryDescriptor, temporaryName);
    temporaryExists = false;
    syncOperations.syncDescriptor(directoryDescriptor, "cleanup");
    assertOwnedDirectoryEntry(directoryDescriptor, targetName, temporaryIdentity, 1, 1);
    requireArtifactDirectoryAuthority(layout);
  } catch {
    throw new EvidenceCommitError(targetCommitted);
  } finally {
    if (temporaryDescriptor !== undefined) closeSync(temporaryDescriptor);
    let cleanupFailed = false;
    if (temporaryExists && temporaryIdentity !== undefined) {
      try {
        assertOwnedDirectoryEntry(directoryDescriptor, temporaryName, temporaryIdentity, 1, 2);
        unlinkDirectoryEntry(directoryDescriptor, temporaryName);
        syncOperations.syncDescriptor(directoryDescriptor, "cleanup");
      } catch {
        cleanupFailed = true;
      }
    }
    closeSync(directoryDescriptor);
    if (cleanupFailed) throw new EvidenceCommitError(targetCommitted);
  }
}

function openAuthorizedArtifactDirectory(layout: RunArtifactLayout, path: string): number {
  if (dirname(path) !== layout.runDirectory) throw new EvidenceCommitError(false);
  requireArtifactDirectoryAuthority(layout);
  const descriptor = openSync(
    layout.runDirectory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  try {
    const authority = requireAuthority(layout);
    requireDirectoryIdentity(fstatSync(descriptor), authority.runDirectory);
    requireArtifactDirectoryAuthority(layout);
    return descriptor;
  } catch {
    closeSync(descriptor);
    throw new EvidenceCommitError(false);
  }
}

function requireArtifactDirectoryAuthority(layout: RunArtifactLayout): void {
  const authority = requireAuthority(layout);
  requireDirectoryIdentity(lstatSync(layout.outputRoot), authority.outputRoot);
  requireDirectoryIdentity(lstatSync(join(layout.outputRoot, "runs")), authority.runsDirectory);
  requireDirectoryIdentity(lstatSync(layout.runDirectory), authority.runDirectory);
}

function requireAuthority(layout: RunArtifactLayout): NonNullable<RunArtifactLayout["authority"]> {
  if (layout.authority === undefined) throw new EvidenceCommitError(false);
  return layout.authority;
}

function requireDirectoryIdentity(
  stats: { isDirectory(): boolean; isSymbolicLink(): boolean; dev: number; ino: number },
  expected: RunArtifactDirectoryIdentity
): void {
  if (!stats.isDirectory() || stats.isSymbolicLink() || stats.dev !== expected.device || stats.ino !== expected.inode) {
    throw new EvidenceCommitError(false);
  }
}

function assertOwnedDirectoryEntry(
  directoryDescriptor: number,
  entryName: string,
  expected: FileIdentity,
  minimumLinks: number,
  maximumLinks: number
): void {
  const descriptor = openDirectoryEntry(
    directoryDescriptor,
    entryName,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const stats = fstatSync(descriptor);
    const identity = { device: stats.dev, inode: stats.ino };
    if (!stats.isFile() || stats.nlink < minimumLinks || stats.nlink > maximumLinks
      || !sameFileIdentity(identity, expected)) throw new EvidenceCommitError(true);
  } finally {
    closeSync(descriptor);
  }
}

function descriptorIdentity(descriptor: number): FileIdentity {
  const stats = fstatSync(descriptor);
  return { device: stats.dev, inode: stats.ino };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function serializeEvidence(value: unknown): string {
  return JSON.stringify(sanitizeBenchmarkArtifactValue(value), null, 2);
}

import { randomUUID } from "node:crypto";
import { closeSync, constants, fchmodSync, fsyncSync, fstatSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import {
  openAuthorizedRunDirectory,
  requireRunArtifactAuthority,
} from "../infrastructure/workspace/run-artifact-authority.js";
import type { RunArtifactLayout } from "../infrastructure/workspace/types.js";
import { sanitizeBenchmarkArtifactValue } from "../shared/artifact-sanitization.js";
import {
  linkDirectoryEntry,
  openDirectoryEntry,
  renameDirectoryEntryNoReplace,
  unlinkDirectoryEntry,
} from "../infrastructure/filesystem/directory-entry-operations.js";

export interface EvidenceArtifactIdentity {
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
  public readonly committedIdentity?: EvidenceArtifactIdentity;

  public constructor(targetCommitted: boolean, committedIdentity?: EvidenceArtifactIdentity) {
    super("terminal evidence persistence failed");
    this.name = "EvidenceCommitError";
    this.targetCommitted = targetCommitted;
    this.committedIdentity = committedIdentity;
  }
}

export async function writeAtomicEvidenceJson(
  layout: RunArtifactLayout,
  path: string,
  value: unknown,
  syncOperations: EvidenceSyncOperations = durableEvidenceSync,
): Promise<EvidenceArtifactIdentity> {
  return commitEvidence(layout, path, value, syncOperations);
}

export function commitAtomicEvidenceJson(
  layout: RunArtifactLayout,
  path: string,
  value: unknown,
  syncOperations: EvidenceSyncOperations = durableEvidenceSync,
): EvidenceArtifactIdentity {
  return commitEvidence(layout, path, value, syncOperations);
}

export function removeAtomicEvidence(
  layout: RunArtifactLayout,
  path: string,
  expectedIdentity: EvidenceArtifactIdentity,
): void {
  const directoryDescriptor = openAuthorizedArtifactDirectory(layout, path);
  const targetName = basename(path);
  const quarantineName = `.${targetName}.rollback.${randomUUID()}`;
  let quarantineDescriptor: number | undefined;
  let quarantined = false;
  try {
    requireRunArtifactAuthority(layout);
    renameDirectoryEntryNoReplace(directoryDescriptor, targetName, quarantineName);
    quarantined = true;
    quarantineDescriptor = openDirectoryEntry(
      directoryDescriptor,
      quarantineName,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const targetStats = fstatSync(quarantineDescriptor);
    const targetIdentity = { device: targetStats.dev, inode: targetStats.ino };
    if (
      !targetStats.isFile() ||
      targetStats.nlink !== 1 ||
      !sameFileIdentity(targetIdentity, expectedIdentity)
    ) {
      throw new EvidenceCommitError(true, expectedIdentity);
    }
    closeSync(quarantineDescriptor);
    quarantineDescriptor = undefined;
    unlinkDirectoryEntry(directoryDescriptor, quarantineName);
    quarantined = false;
    fsyncSync(directoryDescriptor);
    requireRunArtifactAuthority(layout);
  } catch {
    if (quarantineDescriptor !== undefined) {
      closeSync(quarantineDescriptor);
      quarantineDescriptor = undefined;
    }
    if (quarantined) {
      try {
        renameDirectoryEntryNoReplace(directoryDescriptor, quarantineName, targetName);
        quarantined = false;
        fsyncSync(directoryDescriptor);
        requireRunArtifactAuthority(layout);
      } catch {}
    }
    throw new EvidenceCommitError(true, expectedIdentity);
  } finally {
    if (quarantineDescriptor !== undefined) closeSync(quarantineDescriptor);
    closeSync(directoryDescriptor);
  }
}

function commitEvidence(
  layout: RunArtifactLayout,
  path: string,
  value: unknown,
  syncOperations: EvidenceSyncOperations,
): EvidenceArtifactIdentity {
  const directoryDescriptor = openAuthorizedArtifactDirectory(layout, path);
  const targetName = basename(path);
  const temporaryName = `.${targetName}.${randomUUID()}.tmp`;
  let temporaryDescriptor: number | undefined;
  let temporaryIdentity: EvidenceArtifactIdentity | undefined;
  let targetCommitted = false;
  let temporaryExists = false;
  try {
    temporaryDescriptor = openDirectoryEntry(
      directoryDescriptor,
      temporaryName,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    temporaryExists = true;
    fchmodSync(temporaryDescriptor, 0o600);
    temporaryIdentity = descriptorIdentity(temporaryDescriptor);
    writeFileSync(temporaryDescriptor, serializeEvidence(value), "utf8");
    syncOperations.syncDescriptor(temporaryDescriptor, "payload");
    assertOwnedDirectoryEntry(directoryDescriptor, temporaryName, temporaryIdentity, 1, 1);
    requireRunArtifactAuthority(layout);
    linkDirectoryEntry(directoryDescriptor, temporaryName, targetName);
    targetCommitted = true;
    assertOwnedDirectoryEntry(directoryDescriptor, targetName, temporaryIdentity, 2, 2);
    syncOperations.syncDescriptor(directoryDescriptor, "publication");
    requireRunArtifactAuthority(layout);
    unlinkDirectoryEntry(directoryDescriptor, temporaryName);
    temporaryExists = false;
    syncOperations.syncDescriptor(directoryDescriptor, "cleanup");
    assertOwnedDirectoryEntry(directoryDescriptor, targetName, temporaryIdentity, 1, 1);
    requireRunArtifactAuthority(layout);
    return temporaryIdentity;
  } catch {
    throw new EvidenceCommitError(targetCommitted, targetCommitted ? temporaryIdentity : undefined);
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
    if (cleanupFailed) {
      throw new EvidenceCommitError(
        targetCommitted,
        targetCommitted ? temporaryIdentity : undefined,
      );
    }
  }
}

function openAuthorizedArtifactDirectory(layout: RunArtifactLayout, path: string): number {
  if (dirname(path) !== layout.runDirectory) throw new EvidenceCommitError(false);
  try {
    return openAuthorizedRunDirectory(layout);
  } catch {
    throw new EvidenceCommitError(false);
  }
}

function assertOwnedDirectoryEntry(
  directoryDescriptor: number,
  entryName: string,
  expected: EvidenceArtifactIdentity,
  minimumLinks: number,
  maximumLinks: number,
): void {
  const descriptor = openDirectoryEntry(
    directoryDescriptor,
    entryName,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stats = fstatSync(descriptor);
    const identity = { device: stats.dev, inode: stats.ino };
    if (
      !stats.isFile() ||
      stats.nlink < minimumLinks ||
      stats.nlink > maximumLinks ||
      !sameFileIdentity(identity, expected)
    )
      throw new EvidenceCommitError(true);
  } finally {
    closeSync(descriptor);
  }
}

function descriptorIdentity(descriptor: number): EvidenceArtifactIdentity {
  const stats = fstatSync(descriptor);
  return { device: stats.dev, inode: stats.ino };
}

function sameFileIdentity(
  left: EvidenceArtifactIdentity,
  right: EvidenceArtifactIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function serializeEvidence(value: unknown): string {
  return JSON.stringify(sanitizeBenchmarkArtifactValue(value), null, 2);
}

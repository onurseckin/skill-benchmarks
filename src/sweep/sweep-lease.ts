import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { link, open, readdir } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import { openSweepLeaseNamespace, type SweepLeaseNamespace } from "./sweep-lease-namespace.js";
import { bindSweepPlan } from "./sweep-plan.js";
import {
  handleIdentity,
  isExistingPathError,
  isStaleOwner,
  leaseConflict,
  pathExists,
  requireProcessStartIdentity,
  type FileIdentity,
  type LeaseOwner,
  type OwnerRole,
} from "./sweep-lease-process.js";

export const sweepLeaseFileName = ".owner.lock";
export const sweepLeaseConflictMessage = "Sweep identity is already running in this output root";

const recoveryFileName = ".owner.recovery";
const candidatePrefix = ".owner.stage.";
const maximumLockBytes = 4096;

interface OwnedFile {
  readonly owner: LeaseOwner;
  readonly identity: FileIdentity;
  readonly candidatePath: string;
}

export interface SweepLeaseProbeHooks {
  beforeRecoveryFinalize?(): void | Promise<void>;
  beforeReleaseRetirement?(lockPath: string): void | Promise<void>;
}

export interface SweepLease {
  bindPlan(sweepId: string, fingerprint: string, autoResume: boolean): Promise<void>;
  release(): Promise<void>;
}

export async function acquireSweepLease(
  outputRoot: string,
  sweepId: string,
  probeHooks: SweepLeaseProbeHooks = {},
): Promise<SweepLease> {
  const leaseNamespace = await openSweepLeaseNamespace(outputRoot, sweepId, conflict);
  const namespaceDirectory = leaseNamespace.path;
  const lockPath = join(namespaceDirectory, sweepLeaseFileName);
  const recoveryPath = join(namespaceDirectory, recoveryFileName);
  let candidate: OwnedFile | undefined;
  let recoveryCandidate: OwnedFile | undefined;
  try {
    await clearStaleRecovery(leaseNamespace, recoveryPath);
    candidate = await prepareCandidate(leaseNamespace, "owner");
    recoveryCandidate = await prepareCandidate(leaseNamespace, "recovery");
    if (!(await publishCandidate(recoveryCandidate, recoveryPath, leaseNamespace)))
      throw conflict();
    let replacementPublished = false;
    let recoveryPublished = true;
    try {
      await reclaimStaleLeaseDebris(leaseNamespace, lockPath, recoveryPath, candidate);
      if (await pathExists(lockPath)) {
        const existingOwner = await readPublishedOwner(lockPath, namespaceDirectory);
        if (existingOwner === undefined || !isStaleOwner(existingOwner.owner)) throw conflict();
        await reclaimPublishedPath(lockPath, existingOwner, leaseNamespace);
      }
      if (!(await publishCandidate(candidate, lockPath, leaseNamespace))) throw conflict();
      replacementPublished = true;
      await probeHooks.beforeRecoveryFinalize?.();
      await reclaimPublishedPath(recoveryPath, recoveryCandidate, leaseNamespace);
      recoveryPublished = false;
      await assertPublishedPath(lockPath, candidate, namespaceDirectory);
      return createLease(lockPath, leaseNamespace, candidate, probeHooks);
    } catch (error) {
      if (replacementPublished) await reclaimPublishedPath(lockPath, candidate, leaseNamespace);
      if (recoveryPublished) {
        await reclaimPublishedPath(recoveryPath, recoveryCandidate, leaseNamespace);
      }
      throw error;
    }
  } catch (error) {
    if (candidate !== undefined) await reclaimCandidate(candidate, leaseNamespace).catch(() => {});
    if (recoveryCandidate !== undefined)
      await reclaimCandidate(recoveryCandidate, leaseNamespace).catch(() => {});
    await leaseNamespace.close();
    throw error;
  }
}

function createLease(
  lockPath: string,
  leaseNamespace: SweepLeaseNamespace,
  ownedFile: OwnedFile,
  probeHooks: SweepLeaseProbeHooks,
): SweepLease {
  const namespaceDirectory = leaseNamespace.path;
  let released = false;
  let releaseRecovery: OwnedFile | undefined;
  let releaseHookCalled = false;
  let ownerReclaimed = false;
  let recoveryReclaimed = false;
  return {
    async bindPlan(sweepId: string, fingerprint: string, autoResume: boolean): Promise<void> {
      if (released) throw conflict();
      await assertPublishedPath(lockPath, ownedFile, namespaceDirectory);
      await bindSweepPlan(leaseNamespace, sweepLeaseFileName, sweepId, fingerprint, autoResume);
      await assertPublishedPath(lockPath, ownedFile, namespaceDirectory);
    },
    async release(): Promise<void> {
      if (released) return;
      if (releaseRecovery === undefined) {
        await clearStaleRecovery(leaseNamespace, join(namespaceDirectory, recoveryFileName));
        const recoveryCandidate = await prepareCandidate(leaseNamespace, "recovery");
        if (
          !(await publishCandidate(
            recoveryCandidate,
            join(namespaceDirectory, recoveryFileName),
            leaseNamespace,
          ))
        ) {
          throw conflict();
        }
        releaseRecovery = recoveryCandidate;
      }
      if (!releaseHookCalled) {
        releaseHookCalled = true;
        await probeHooks.beforeReleaseRetirement?.(lockPath);
      }
      if (!ownerReclaimed) {
        await reclaimPublishedPath(lockPath, ownedFile, leaseNamespace);
        ownerReclaimed = true;
      }
      if (!recoveryReclaimed) {
        await reclaimPublishedPath(
          join(namespaceDirectory, recoveryFileName),
          releaseRecovery,
          leaseNamespace,
        );
        recoveryReclaimed = true;
      }
      await leaseNamespace.close();
      released = true;
    },
  };
}

async function prepareCandidate(
  leaseNamespace: SweepLeaseNamespace,
  role: OwnerRole,
): Promise<OwnedFile> {
  const namespaceDirectory = leaseNamespace.path;
  const token = randomUUID();
  const candidateName = `${candidatePrefix}${role}.${token}`;
  const candidatePath = join(namespaceDirectory, candidateName);
  let handle: FileHandle | undefined;
  let candidateIdentity: FileIdentity | undefined;
  try {
    await leaseNamespace.sync();
    handle = await open(candidatePath, "wx", 0o600);
    await handle.chmod(0o600);
    const identity = await handleIdentity(handle);
    candidateIdentity = identity;
    const owner: LeaseOwner = {
      version: "2",
      role,
      token,
      candidateName,
      pid: process.pid,
      hostname: hostname(),
      processStartIdentity: requireProcessStartIdentity(process.pid),
      createdAtMs: Date.now(),
    };
    await handle.writeFile(JSON.stringify(owner), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await leaseNamespace.sync();
    const candidate = { owner, identity, candidatePath };
    await assertCandidatePath(candidate);
    return candidate;
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => {});
    if (candidateIdentity !== undefined) {
      await leaseNamespace.removeEntry(candidateName, candidateIdentity, 1).catch(() => {});
    }
    throw error;
  }
}

async function publishCandidate(
  candidate: OwnedFile,
  publishedPath: string,
  leaseNamespace: SweepLeaseNamespace,
): Promise<boolean> {
  await leaseNamespace.sync();
  let published = false;
  try {
    await link(candidate.candidatePath, publishedPath);
    published = true;
    await leaseNamespace.sync();
    await assertPublishedPath(publishedPath, candidate, leaseNamespace.path);
    return true;
  } catch (error) {
    if (!published && isExistingPathError(error)) return false;
    if (published) {
      await reclaimPublishedPath(publishedPath, candidate, leaseNamespace);
    }
    throw error;
  }
}

async function reclaimPublishedPath(
  publishedPath: string,
  expected: OwnedFile,
  leaseNamespace: SweepLeaseNamespace,
): Promise<void> {
  await leaseNamespace.sync();
  await assertPublishedPath(publishedPath, expected, leaseNamespace.path);
  await leaseNamespace.removeEntry(basename(publishedPath), expected.identity, 2);
  await reclaimCandidate(expected, leaseNamespace);
}

async function reclaimCandidate(
  candidate: OwnedFile,
  leaseNamespace: SweepLeaseNamespace,
): Promise<void> {
  await leaseNamespace.removeEntry(candidate.owner.candidateName, candidate.identity, 1);
}

async function clearStaleRecovery(
  leaseNamespace: SweepLeaseNamespace,
  recoveryPath: string,
): Promise<void> {
  const namespaceDirectory = leaseNamespace.path;
  if (!(await pathExists(recoveryPath))) return;
  const recoveryOwner = await readPublishedOwner(recoveryPath, namespaceDirectory);
  if (recoveryOwner === undefined || !isStaleOwner(recoveryOwner.owner)) throw conflict();
  await reclaimPublishedPath(recoveryPath, recoveryOwner, leaseNamespace);
}

async function reclaimStaleLeaseDebris(
  leaseNamespace: SweepLeaseNamespace,
  lockPath: string,
  recoveryPath: string,
  pendingOwner: OwnedFile,
): Promise<void> {
  const protectedCandidates = new Set([pendingOwner.owner.candidateName]);
  for (const publishedPath of [lockPath, recoveryPath]) {
    const published = await readPublishedOwner(publishedPath, leaseNamespace.path);
    if (published !== undefined) protectedCandidates.add(published.owner.candidateName);
  }
  for (const entry of await readdir(leaseNamespace.path)) {
    const isStage = entry.startsWith(candidatePrefix);
    const isRetired = entry.startsWith(".owner.retired.");
    if ((!isStage && !isRetired) || protectedCandidates.has(entry)) continue;
    const inspected = await readOwnerFile(join(leaseNamespace.path, entry));
    if (inspected === undefined || !isStaleOwner(inspected.owner)) continue;
    if (isStage && entry !== inspected.owner.candidateName) throw conflict();
    await leaseNamespace.removeEntry(entry, inspected.identity, inspected.identity.linkCount);
  }
}

async function assertCandidatePath(candidate: OwnedFile): Promise<void> {
  const inspected = await readOwnerFile(candidate.candidatePath);
  if (!sameOwnedFile(inspected, candidate) || inspected?.identity.linkCount !== 1) throw conflict();
}

async function assertPublishedPath(
  publishedPath: string,
  expected: OwnedFile,
  namespaceDirectory: string,
): Promise<void> {
  const inspected = await readPublishedOwner(publishedPath, namespaceDirectory);
  if (!sameOwnedFile(inspected, expected)) throw conflict();
}

async function readPublishedOwner(
  path: string,
  namespaceDirectory: string,
): Promise<OwnedFile | undefined> {
  const inspected = await readOwnerFile(path);
  if (inspected === undefined) return undefined;
  const candidatePath = join(namespaceDirectory, inspected.owner.candidateName);
  const candidate = await readOwnerFile(candidatePath);
  if (
    !sameOwnedFile(inspected, candidate) ||
    inspected.identity.linkCount !== 2 ||
    candidate?.identity.linkCount !== 2
  )
    return undefined;
  return { ...inspected, candidatePath };
}

async function readOwnerFile(path: string): Promise<Omit<OwnedFile, "candidatePath"> | undefined> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const initial = await handle.stat();
    if (!initial.isFile() || initial.size <= 0 || initial.size > maximumLockBytes) return undefined;
    const raw = await handle.readFile("utf8");
    const confirmed = await handle.stat();
    if (confirmed.dev !== initial.dev || confirmed.ino !== initial.ino) return undefined;
    const owner = JSON.parse(raw) as Partial<LeaseOwner>;
    if (!isLeaseOwner(owner)) return undefined;
    return {
      owner,
      identity: { device: initial.dev, inode: initial.ino, linkCount: initial.nlink },
    };
  } catch {
    return undefined;
  } finally {
    if (handle !== undefined) await handle.close().catch(() => {});
  }
}

function isLeaseOwner(value: Partial<LeaseOwner>): value is LeaseOwner {
  return (
    value.version === "2" &&
    (value.role === "owner" || value.role === "recovery") &&
    typeof value.token === "string" &&
    value.token.length > 0 &&
    value.token.length <= 128 &&
    typeof value.candidateName === "string" &&
    value.candidateName === `${candidatePrefix}${value.role}.${value.token}` &&
    !value.candidateName.includes("/") &&
    !value.candidateName.includes("\\") &&
    Number.isSafeInteger(value.pid) &&
    (value.pid ?? 0) > 0 &&
    typeof value.hostname === "string" &&
    value.hostname.length > 0 &&
    value.hostname.length <= 255 &&
    typeof value.processStartIdentity === "string" &&
    value.processStartIdentity.length > 0 &&
    value.processStartIdentity.length <= 128 &&
    Number.isSafeInteger(value.createdAtMs) &&
    (value.createdAtMs ?? 0) > 0
  );
}

function sameOwnedFile(
  left: { readonly owner: LeaseOwner; readonly identity: FileIdentity } | undefined,
  right: { readonly owner: LeaseOwner; readonly identity: FileIdentity } | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    sameOwner(left.owner, right.owner) &&
    left.identity.device === right.identity.device &&
    left.identity.inode === right.identity.inode
  );
}

function sameOwner(left: LeaseOwner, right: LeaseOwner): boolean {
  return (
    left.version === right.version &&
    left.role === right.role &&
    left.token === right.token &&
    left.candidateName === right.candidateName &&
    left.pid === right.pid &&
    left.hostname === right.hostname &&
    left.processStartIdentity === right.processStartIdentity &&
    left.createdAtMs === right.createdAtMs
  );
}

function conflict(): TypeError {
  return leaseConflict(sweepLeaseConflictMessage);
}

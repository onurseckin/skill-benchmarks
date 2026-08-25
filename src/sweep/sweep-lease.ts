import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { link, lstat, open, rename } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { openSweepLeaseNamespace, type SweepLeaseNamespace } from "./sweep-lease-namespace.js";
import { bindSweepPlan } from "./sweep-plan.js";

export const sweepLeaseFileName = ".owner.lock";
export const sweepLeaseConflictMessage = "Sweep identity is already running in this output root";

const recoveryFileName = ".owner.recovery";
const candidatePrefix = ".owner.stage.";
const historyPrefix = ".owner.retired.";
const maximumLockBytes = 4096;

type OwnerRole = "owner" | "recovery";

interface LeaseOwner {
  readonly version: "2";
  readonly role: OwnerRole;
  readonly token: string;
  readonly candidateName: string;
  readonly pid: number;
  readonly hostname: string;
  readonly processStartIdentity: string;
  readonly createdAtMs: number;
}

interface FileIdentity {
  readonly device: number;
  readonly inode: number;
  readonly linkCount: number;
}

interface OwnedFile {
  readonly owner: LeaseOwner;
  readonly identity: FileIdentity;
  readonly candidatePath: string;
}

interface RetirementState {
  readonly historyPath: string;
  moved: boolean;
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
  outputRoot: string, sweepId: string, probeHooks: SweepLeaseProbeHooks = {}
): Promise<SweepLease> {
  const leaseNamespace = await openSweepLeaseNamespace(outputRoot, sweepId, conflict);
  const namespaceDirectory = leaseNamespace.path;
  const lockPath = join(namespaceDirectory, sweepLeaseFileName);
  const recoveryPath = join(namespaceDirectory, recoveryFileName);
  try {
    await clearStaleRecovery(leaseNamespace, recoveryPath);
    const candidate = await prepareCandidate(leaseNamespace, "owner");
    const recoveryCandidate = await prepareCandidate(leaseNamespace, "recovery");
    if (!await publishCandidate(recoveryCandidate, recoveryPath, leaseNamespace)) throw conflict();
    let replacementPublished = false;
    let recoveryPublished = true;
    try {
      if (await pathExists(lockPath)) {
        const existingOwner = await readPublishedOwner(lockPath, namespaceDirectory);
        if (existingOwner === undefined || !isStaleOwner(existingOwner.owner)) throw conflict();
        await retirePublishedPath(lockPath, existingOwner, leaseNamespace, "stale");
      }
      if (!await publishCandidate(candidate, lockPath, leaseNamespace)) throw conflict();
      replacementPublished = true;
      await probeHooks.beforeRecoveryFinalize?.();
      await retirePublishedPath(recoveryPath, recoveryCandidate, leaseNamespace, "recovery");
      recoveryPublished = false;
      await assertPublishedPath(lockPath, candidate, namespaceDirectory);
      return createLease(lockPath, leaseNamespace, candidate, probeHooks);
    } catch (error) {
      if (replacementPublished) await retirePublishedPath(lockPath, candidate, leaseNamespace, "rollback");
      if (recoveryPublished) {
        await retirePublishedPath(recoveryPath, recoveryCandidate, leaseNamespace, "recovery-failed");
      }
      throw error;
    }
  } catch (error) {
    await leaseNamespace.close();
    throw error;
  }
}

function createLease(
  lockPath: string, leaseNamespace: SweepLeaseNamespace, ownedFile: OwnedFile, probeHooks: SweepLeaseProbeHooks
): SweepLease {
  const namespaceDirectory = leaseNamespace.path;
  let released = false;
  let releaseRecovery: OwnedFile | undefined;
  let ownerRetirement: RetirementState | undefined;
  let recoveryRetirement: RetirementState | undefined;
  let releaseHookCalled = false;
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
        if (!await publishCandidate(recoveryCandidate, join(namespaceDirectory, recoveryFileName), leaseNamespace)) {
          throw conflict();
        }
        releaseRecovery = recoveryCandidate;
      }
      if (!releaseHookCalled) {
        releaseHookCalled = true;
        await probeHooks.beforeReleaseRetirement?.(lockPath);
      }
      ownerRetirement ??= createRetirement(namespaceDirectory, "released");
      await finishRetirement(lockPath, ownedFile, leaseNamespace, ownerRetirement);
      recoveryRetirement ??= createRetirement(namespaceDirectory, "release-transition");
      await finishRetirement(
        join(namespaceDirectory, recoveryFileName), releaseRecovery, leaseNamespace, recoveryRetirement
      );
      await leaseNamespace.close();
      released = true;
    },
  };
}

async function prepareCandidate(leaseNamespace: SweepLeaseNamespace, role: OwnerRole): Promise<OwnedFile> {
  const namespaceDirectory = leaseNamespace.path;
  const token = randomUUID();
  const candidateName = `${candidatePrefix}${role}.${token}`;
  const candidatePath = join(namespaceDirectory, candidateName);
  let handle: FileHandle | undefined;
  try {
    await leaseNamespace.sync();
    handle = await open(candidatePath, "wx", 0o600);
    const identity = await handleIdentity(handle);
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
    if (await pathExists(candidatePath)) {
      await retireUnknownPath(candidatePath, leaseNamespace, "incomplete").catch(() => {});
    }
    throw error;
  }
}

async function publishCandidate(
  candidate: OwnedFile, publishedPath: string, leaseNamespace: SweepLeaseNamespace
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
      await retirePublishedPath(publishedPath, candidate, leaseNamespace, "publication-failed");
    }
    throw error;
  }
}

async function retirePublishedPath(
  publishedPath: string, expected: OwnedFile, leaseNamespace: SweepLeaseNamespace, reason: string
): Promise<void> {
  await finishRetirement(
    publishedPath, expected, leaseNamespace, createRetirement(leaseNamespace.path, reason)
  );
}

function createRetirement(namespaceDirectory: string, reason: string): RetirementState {
  return { historyPath: join(namespaceDirectory, `${historyPrefix}${reason}.${randomUUID()}`), moved: false };
}

async function finishRetirement(
  publishedPath: string, expected: OwnedFile, leaseNamespace: SweepLeaseNamespace, state: RetirementState
): Promise<void> {
  await leaseNamespace.sync();
  if (!state.moved) {
    await assertPublishedPath(publishedPath, expected, leaseNamespace.path);
    await rename(publishedPath, state.historyPath);
    state.moved = true;
  }
  await leaseNamespace.sync();
  const retiredOwner = await readPublishedOwner(state.historyPath, leaseNamespace.path);
  if (!sameOwnedFile(retiredOwner, expected)) throw conflict();
}

async function retireUnknownPath(path: string, leaseNamespace: SweepLeaseNamespace, reason: string): Promise<void> {
  const namespaceDirectory = leaseNamespace.path;
  const historyPath = join(namespaceDirectory, `${historyPrefix}${reason}.${randomUUID()}`);
  await leaseNamespace.sync();
  await rename(path, historyPath);
  await leaseNamespace.sync();
}

async function clearStaleRecovery(leaseNamespace: SweepLeaseNamespace, recoveryPath: string): Promise<void> {
  const namespaceDirectory = leaseNamespace.path;
  if (!await pathExists(recoveryPath)) return;
  const recoveryOwner = await readPublishedOwner(recoveryPath, namespaceDirectory);
  if (recoveryOwner === undefined || !isStaleOwner(recoveryOwner.owner)) throw conflict();
  await retirePublishedPath(recoveryPath, recoveryOwner, leaseNamespace, "stale-recovery");
}

async function assertCandidatePath(candidate: OwnedFile): Promise<void> {
  const inspected = await readOwnerFile(candidate.candidatePath);
  if (!sameOwnedFile(inspected, candidate) || inspected?.identity.linkCount !== 1) throw conflict();
}

async function assertPublishedPath(
  publishedPath: string,
  expected: OwnedFile,
  namespaceDirectory: string
): Promise<void> {
  const inspected = await readPublishedOwner(publishedPath, namespaceDirectory);
  if (!sameOwnedFile(inspected, expected)) throw conflict();
}

async function readPublishedOwner(path: string, namespaceDirectory: string): Promise<OwnedFile | undefined> {
  const inspected = await readOwnerFile(path);
  if (inspected === undefined) return undefined;
  const candidatePath = join(namespaceDirectory, inspected.owner.candidateName);
  const candidate = await readOwnerFile(candidatePath);
  if (!sameOwnedFile(inspected, candidate) || inspected.identity.linkCount !== 2
    || candidate?.identity.linkCount !== 2) return undefined;
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
    return { owner, identity: { device: initial.dev, inode: initial.ino, linkCount: initial.nlink } };
  } catch {
    return undefined;
  } finally {
    if (handle !== undefined) await handle.close().catch(() => {});
  }
}

function isLeaseOwner(value: Partial<LeaseOwner>): value is LeaseOwner {
  return value.version === "2" && (value.role === "owner" || value.role === "recovery")
    && typeof value.token === "string" && value.token.length > 0 && value.token.length <= 128
    && typeof value.candidateName === "string"
    && value.candidateName === `${candidatePrefix}${value.role}.${value.token}`
    && !value.candidateName.includes("/") && !value.candidateName.includes("\\")
    && Number.isSafeInteger(value.pid) && (value.pid ?? 0) > 0
    && typeof value.hostname === "string" && value.hostname.length > 0 && value.hostname.length <= 255
    && typeof value.processStartIdentity === "string"
    && value.processStartIdentity.length > 0 && value.processStartIdentity.length <= 128
    && Number.isSafeInteger(value.createdAtMs) && (value.createdAtMs ?? 0) > 0;
}

function sameOwnedFile(
  left: { readonly owner: LeaseOwner; readonly identity: FileIdentity } | undefined,
  right: { readonly owner: LeaseOwner; readonly identity: FileIdentity } | undefined
): boolean {
  return left !== undefined && right !== undefined && sameOwner(left.owner, right.owner)
    && left.identity.device === right.identity.device && left.identity.inode === right.identity.inode;
}

function sameOwner(left: LeaseOwner, right: LeaseOwner): boolean {
  return left.version === right.version && left.role === right.role && left.token === right.token
    && left.candidateName === right.candidateName && left.pid === right.pid && left.hostname === right.hostname
    && left.processStartIdentity === right.processStartIdentity && left.createdAtMs === right.createdAtMs;
}

function isStaleOwner(owner: LeaseOwner): boolean {
  if (owner.hostname !== hostname()) return false;
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    return isMissingProcessError(error);
  }
  const currentIdentity = getProcessStartIdentity(owner.pid);
  return currentIdentity !== undefined && currentIdentity !== owner.processStartIdentity;
}

async function handleIdentity(handle: FileHandle): Promise<FileIdentity> {
  const value = await handle.stat();
  return { device: value.dev, inode: value.ino, linkCount: value.nlink };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

function requireProcessStartIdentity(pid: number): string {
  const identity = getProcessStartIdentity(pid);
  if (identity === undefined) throw new TypeError("Unable to establish sweep owner process identity");
  return identity;
}

function getProcessStartIdentity(pid: number): string | undefined {
  try {
    const output = execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
      timeout: 2000,
    }).trim();
    return output.length > 0 ? output : undefined;
  } catch {
    return undefined;
  }
}

function conflict(): TypeError {
  return new TypeError(sweepLeaseConflictMessage);
}

function isExistingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isMissingProcessError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}

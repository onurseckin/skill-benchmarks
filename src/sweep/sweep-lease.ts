import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { FileHandle } from "node:fs/promises";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";

export const sweepLeaseFileName = ".owner.lock";
export const sweepLeaseConflictMessage = "Sweep identity is already running in this output root";

const recoveryFileName = ".owner.recovery";
const maximumLockBytes = 4096;

interface LeaseOwner {
  readonly version: "1";
  readonly token: string;
  readonly pid: number;
  readonly hostname: string;
  readonly processStartIdentity: string;
  readonly createdAtMs: number;
}

interface FileIdentity {
  readonly device: number;
  readonly inode: number;
}

interface CreatedOwner {
  readonly owner: LeaseOwner;
  readonly identity: FileIdentity;
}

export interface SweepLease {
  readonly planPath: string;
  release(): Promise<void>;
}

export async function acquireSweepLease(outputRoot: string, sweepId: string): Promise<SweepLease> {
  const canonicalOutputRoot = await canonicalizeOwnershipRoot(outputRoot);
  const namespaceDirectory = join(canonicalOutputRoot, "sweeps", sweepId);
  const lockPath = join(namespaceDirectory, sweepLeaseFileName);
  const recoveryPath = join(namespaceDirectory, recoveryFileName);
  await assertNoSymlinkComponents(namespaceDirectory);
  await mkdir(namespaceDirectory, { recursive: true });
  await assertNoSymlinkComponents(namespaceDirectory);
  await clearAbandonedRecovery(recoveryPath);
  const createdLease = await tryCreateLease(lockPath, recoveryPath);
  if (createdLease !== undefined) return createLease(lockPath, namespaceDirectory, createdLease);
  const staleOwner = await readInspectableOwner(lockPath);
  if (staleOwner === undefined || !await isStaleOwner(staleOwner.owner)) {
    throw new TypeError(sweepLeaseConflictMessage);
  }
  const recoveryOwner = await tryCreateOwnerFile(recoveryPath);
  if (recoveryOwner === undefined) throw new TypeError(sweepLeaseConflictMessage);
  try {
    const confirmedOwner = await readInspectableOwner(lockPath);
    if (confirmedOwner === undefined || confirmedOwner.owner.token !== staleOwner.owner.token
      || !sameIdentity(confirmedOwner.identity, staleOwner.identity)) {
      throw new TypeError(sweepLeaseConflictMessage);
    }
    await unlinkIfIdentityMatches(lockPath, staleOwner.identity);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const replacement = await tryCreateLease(lockPath, recoveryPath, true);
      if (replacement !== undefined) {
        await releaseOwnedFile(recoveryPath, recoveryOwner);
        return createLease(lockPath, namespaceDirectory, replacement);
      }
      await Promise.resolve();
    }
    throw new TypeError(sweepLeaseConflictMessage);
  } catch (error) {
    await releaseOwnedFile(recoveryPath, recoveryOwner);
    throw error;
  }
}

async function canonicalizeOwnershipRoot(outputRoot: string): Promise<string> {
  let existingAncestor = resolve(outputRoot);
  const missingSegments: string[] = [];
  while (!await pathExists(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) throw new TypeError(sweepLeaseConflictMessage);
    missingSegments.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }
  const canonicalAncestor = await realpath(existingAncestor);
  return join(canonicalAncestor, ...missingSegments);
}

function createLease(
  lockPath: string,
  namespaceDirectory: string,
  createdLease: CreatedOwner
): SweepLease {
  let released = false;
  return {
    planPath: join(namespaceDirectory, "plan.json"),
    async release(): Promise<void> {
      if (released) return;
      await releaseOwnedFile(lockPath, createdLease);
      released = true;
    },
  };
}

async function tryCreateLease(
  lockPath: string,
  recoveryPath: string,
  ownsRecovery = false
): Promise<CreatedOwner | undefined> {
  const createdOwner = await tryCreateOwnerFile(lockPath);
  if (createdOwner === undefined) return undefined;
  if (!ownsRecovery && await pathExists(recoveryPath)) {
    await releaseOwnedFile(lockPath, createdOwner);
    return undefined;
  }
  return createdOwner;
}

async function tryCreateOwnerFile(path: string): Promise<CreatedOwner | undefined> {
  let handle: FileHandle | undefined;
  let identity: FileIdentity | undefined;
  try {
    handle = await open(path, "wx", 0o600);
    identity = await handleIdentity(handle);
    const owner: LeaseOwner = {
      version: "1",
      token: randomUUID(),
      pid: process.pid,
      hostname: hostname(),
      processStartIdentity: requireProcessStartIdentity(process.pid),
      createdAtMs: Date.now(),
    };
    await handle.writeFile(JSON.stringify(owner), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    return { owner, identity };
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => {});
    if (identity !== undefined) await unlinkIfIdentityMatches(path, identity);
    if (isExistingPathError(error)) return undefined;
    throw error;
  }
}

async function clearAbandonedRecovery(recoveryPath: string): Promise<void> {
  const recoveryOwner = await readInspectableOwner(recoveryPath);
  if (recoveryOwner === undefined) {
    if (await pathExists(recoveryPath)) throw new TypeError(sweepLeaseConflictMessage);
    return;
  }
  if (!await isStaleOwner(recoveryOwner.owner)) throw new TypeError(sweepLeaseConflictMessage);
  await releaseOwnedFile(recoveryPath, recoveryOwner);
}

async function readInspectableOwner(
  path: string
): Promise<{ readonly owner: LeaseOwner; readonly identity: FileIdentity } | undefined> {
  try {
    const pathStat = await lstat(path);
    if (!pathStat.isFile() || pathStat.nlink !== 1) return undefined;
    if (pathStat.size <= 0 || pathStat.size > maximumLockBytes) return undefined;
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<LeaseOwner>;
    if (!isLeaseOwner(parsed)) return undefined;
    return { owner: parsed, identity: { device: pathStat.dev, inode: pathStat.ino } };
  } catch {
    return undefined;
  }
}

async function releaseOwnedFile(path: string, createdOwner: CreatedOwner): Promise<void> {
  const currentOwner = await readInspectableOwner(path);
  if (currentOwner === undefined || currentOwner.owner.token !== createdOwner.owner.token
    || !sameIdentity(currentOwner.identity, createdOwner.identity)) {
    throw new TypeError(sweepLeaseConflictMessage);
  }
  await unlinkIfIdentityMatches(path, createdOwner.identity);
}

function isLeaseOwner(value: Partial<LeaseOwner>): value is LeaseOwner {
  return value.version === "1"
    && typeof value.token === "string" && value.token.length > 0 && value.token.length <= 128
    && Number.isSafeInteger(value.pid) && (value.pid ?? 0) > 0
    && typeof value.hostname === "string" && value.hostname.length > 0 && value.hostname.length <= 255
    && typeof value.processStartIdentity === "string"
    && value.processStartIdentity.length > 0 && value.processStartIdentity.length <= 128
    && Number.isSafeInteger(value.createdAtMs) && (value.createdAtMs ?? 0) > 0;
}

async function isStaleOwner(owner: LeaseOwner): Promise<boolean> {
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
  return { device: value.dev, inode: value.ino };
}

async function fileIdentity(path: string): Promise<FileIdentity> {
  const value = await lstat(path);
  if (!value.isFile()) throw new TypeError(sweepLeaseConflictMessage);
  return { device: value.dev, inode: value.ino };
}

async function unlinkIfIdentityMatches(path: string, expected: FileIdentity): Promise<void> {
  try {
    const current = await fileIdentity(path);
    if (!sameIdentity(current, expected)) throw new TypeError(sweepLeaseConflictMessage);
    await unlink(path);
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
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

async function assertNoSymlinkComponents(path: string): Promise<void> {
  const resolvedPath = resolve(path);
  const pathRoot = parse(resolvedPath).root;
  const segments = resolvedPath.slice(pathRoot.length).split(/[\\/]+/).filter(Boolean);
  let currentPath = pathRoot;
  for (const segment of segments) {
    currentPath = join(currentPath, segment);
    try {
      const value = await lstat(currentPath);
      if (value.isSymbolicLink()) throw new TypeError(sweepLeaseConflictMessage);
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }
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

function isExistingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isMissingProcessError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}

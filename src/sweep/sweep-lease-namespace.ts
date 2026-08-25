import { closeSync, constants, fstatSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { basename, dirname, join, parse, resolve } from "node:path";
import {
  openDirectoryEntry,
  renameDirectoryEntryNoReplace,
  unlinkDirectoryEntry,
} from "../infrastructure/filesystem/directory-entry-operations.js";

export interface SweepLeaseEntryIdentity {
  readonly device: number;
  readonly inode: number;
}

export interface SweepLeaseNamespace {
  readonly path: string;
  sync(): Promise<void>;
  removeEntry(name: string, expected: SweepLeaseEntryIdentity, expectedLinkCount: number): Promise<void>;
  close(): Promise<void>;
}

interface DirectoryIdentity {
  readonly device: number;
  readonly inode: number;
}

export async function openSweepLeaseNamespace(
  outputRoot: string,
  sweepId: string,
  conflict: () => Error
): Promise<SweepLeaseNamespace> {
  const canonicalRoot = await canonicalizeOwnershipRoot(outputRoot, conflict);
  const namespacePath = join(canonicalRoot, "sweeps", sweepId);
  await assertNoSymlinkComponents(namespacePath, conflict);
  await mkdir(namespacePath, { recursive: true, mode: 0o700 });
  await assertNoSymlinkComponents(namespacePath, conflict);
  const handle = await open(namespacePath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const identity = await validateHandle(handle, conflict);
    const namespace = createNamespace(namespacePath, handle, identity, conflict);
    await namespace.sync();
    return namespace;
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

function createNamespace(
  path: string,
  handle: FileHandle,
  identity: DirectoryIdentity,
  conflict: () => Error
): SweepLeaseNamespace {
  let closed = false;
  return {
    path,
    async sync(): Promise<void> {
      if (closed) throw conflict();
      await validateHandleIdentity(handle, identity, conflict);
      await validatePathIdentity(path, identity, conflict);
      await handle.sync();
      await validateHandleIdentity(handle, identity, conflict);
      await validatePathIdentity(path, identity, conflict);
    },
    async removeEntry(name, expected, expectedLinkCount): Promise<void> {
      if (closed) throw conflict();
      await validateHandleIdentity(handle, identity, conflict);
      await validatePathIdentity(path, identity, conflict);
      const quarantineName = `${name}.remove`;
      let descriptor: number | undefined;
      let quarantinePresent = false;
      let ownedQuarantine = false;
      try {
        try {
          renameDirectoryEntryNoReplace(handle.fd, name, quarantineName);
        } catch {}
        descriptor = openDirectoryEntry(
          handle.fd,
          quarantineName,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
        );
        quarantinePresent = true;
        const value = fstatSync(descriptor);
        const processUserId = process.getuid?.();
        if (
          !value.isFile()
          || value.dev !== expected.device
          || value.ino !== expected.inode
          || value.nlink !== expectedLinkCount
          || (value.mode & 0o777) !== 0o600
          || (processUserId !== undefined && value.uid !== processUserId)
        ) {
          throw conflict();
        }
        ownedQuarantine = true;
        closeSync(descriptor);
        descriptor = undefined;
        unlinkDirectoryEntry(handle.fd, quarantineName);
        quarantinePresent = false;
        await handle.sync();
        await validateHandleIdentity(handle, identity, conflict);
        await validatePathIdentity(path, identity, conflict);
      } catch {
        if (descriptor !== undefined) closeSync(descriptor);
        if (quarantinePresent && !ownedQuarantine) {
          try {
            renameDirectoryEntryNoReplace(handle.fd, quarantineName, name);
            await handle.sync();
          } catch {}
        }
        throw conflict();
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      await handle.close();
      closed = true;
    },
  };
}

async function validateHandle(handle: FileHandle, conflict: () => Error): Promise<DirectoryIdentity> {
  const value = await handle.stat();
  const processUserId = process.getuid?.();
  if (!value.isDirectory() || (value.mode & 0o777) !== 0o700
    || (processUserId !== undefined && value.uid !== processUserId)) throw conflict();
  return { device: value.dev, inode: value.ino };
}

async function validateHandleIdentity(
  handle: FileHandle,
  expected: DirectoryIdentity,
  conflict: () => Error
): Promise<void> {
  const current = await validateHandle(handle, conflict);
  if (!sameIdentity(current, expected)) throw conflict();
}

async function validatePathIdentity(
  path: string,
  expected: DirectoryIdentity,
  conflict: () => Error
): Promise<void> {
  const value = await lstat(path);
  if (!value.isDirectory() || !sameIdentity({ device: value.dev, inode: value.ino }, expected)) throw conflict();
}

async function canonicalizeOwnershipRoot(outputRoot: string, conflict: () => Error): Promise<string> {
  let existingAncestor = resolve(outputRoot);
  const missingSegments: string[] = [];
  while (!await pathExists(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) throw conflict();
    missingSegments.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }
  return join(await realpath(existingAncestor), ...missingSegments);
}

async function assertNoSymlinkComponents(path: string, conflict: () => Error): Promise<void> {
  const resolvedPath = resolve(path);
  const pathRoot = parse(resolvedPath).root;
  const segments = resolvedPath.slice(pathRoot.length).split(/[\\/]+/).filter(Boolean);
  let currentPath = pathRoot;
  for (const segment of segments) {
    currentPath = join(currentPath, segment);
    try {
      if ((await lstat(currentPath)).isSymbolicLink()) throw conflict();
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }
  }
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

function sameIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

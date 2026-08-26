import { execFileSync } from "node:child_process";
import type { FileHandle } from "node:fs/promises";
import { lstat } from "node:fs/promises";
import { hostname } from "node:os";

export type OwnerRole = "owner" | "recovery";

export interface LeaseOwner {
  readonly version: "2";
  readonly role: OwnerRole;
  readonly token: string;
  readonly candidateName: string;
  readonly pid: number;
  readonly hostname: string;
  readonly processStartIdentity: string;
  readonly createdAtMs: number;
}

export interface FileIdentity {
  readonly device: number;
  readonly inode: number;
  readonly linkCount: number;
}

export function isStaleOwner(owner: LeaseOwner): boolean {
  if (owner.hostname !== hostname()) return false;
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    return isMissingProcessError(error);
  }
  const currentIdentity = getProcessStartIdentity(owner.pid);
  return currentIdentity !== undefined && currentIdentity !== owner.processStartIdentity;
}

export async function handleIdentity(handle: FileHandle): Promise<FileIdentity> {
  const value = await handle.stat();
  return { device: value.dev, inode: value.ino, linkCount: value.nlink };
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

export function requireProcessStartIdentity(pid: number): string {
  const identity = getProcessStartIdentity(pid);
  if (identity === undefined)
    throw new TypeError("Unable to establish sweep owner process identity");
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

export function leaseConflict(message: string): TypeError {
  return new TypeError(message);
}

export function isExistingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

export function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isMissingProcessError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}

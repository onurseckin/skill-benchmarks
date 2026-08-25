import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export const sweepLeaseFileName = ".owner.lock";
export const sweepLeaseConflictMessage = "Sweep identity is already running in this output root";

export interface SweepLease {
  readonly planPath: string;
  release(): Promise<void>;
}

export async function acquireSweepLease(outputRoot: string, sweepId: string): Promise<SweepLease> {
  const namespaceDirectory = join(outputRoot, "sweeps", sweepId);
  const lockPath = join(namespaceDirectory, sweepLeaseFileName);
  const token = randomUUID();
  await mkdir(namespaceDirectory, { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(token, "utf8");
    await handle.sync();
  } catch (error) {
    if (handle !== undefined) await handle.close();
    if (isExistingPathError(error)) throw new TypeError(sweepLeaseConflictMessage);
    throw error;
  }
  await handle.close();
  let released = false;
  return {
    planPath: join(namespaceDirectory, "plan.json"),
    async release(): Promise<void> {
      if (released) return;
      released = true;
      try {
        const ownerToken = await readFile(lockPath, "utf8");
        if (ownerToken !== token) throw new TypeError(sweepLeaseConflictMessage);
        await unlink(lockPath);
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      }
    },
  };
}

function isExistingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

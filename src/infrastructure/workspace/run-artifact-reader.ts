import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  type Stats,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { openDirectoryEntry } from "../filesystem/directory-entry-operations.js";
import { openRetainedDirectory } from "./run-artifact-authority.js";

export type RunArtifactReadFailure = "unavailable" | "invalid";

export class RunArtifactReadError extends Error {
  public constructor(public readonly failure: RunArtifactReadFailure) {
    super("Run artifact read failed");
    this.name = "RunArtifactReadError";
  }
}

export interface CanonicalRunArtifactContents {
  readonly events: string;
  readonly manifest: string;
  readonly result: string;
}

export function readCanonicalRunArtifacts(
  eventsPath: string,
  manifestPath: string,
  resultPath: string,
  expectedRunId: string,
): CanonicalRunArtifactContents {
  const runDirectory = resolve(dirname(eventsPath));
  const runsDirectory = dirname(runDirectory);
  const outputRoot = dirname(runsDirectory);
  if (
    basename(runDirectory) !== expectedRunId ||
    basename(runsDirectory) !== "runs" ||
    resolve(eventsPath) !== join(runDirectory, "events.jsonl") ||
    resolve(manifestPath) !== join(runDirectory, "manifest.json") ||
    resolve(resultPath) !== join(runDirectory, "result.json")
  )
    throw new RunArtifactReadError("invalid");
  const rootDescriptor = openVerifiedDirectory(outputRoot);
  let runsDescriptor: number | undefined;
  let runDescriptor: number | undefined;
  try {
    runsDescriptor = openVerifiedChildDirectory(rootDescriptor, "runs", runsDirectory);
    runDescriptor = openVerifiedChildDirectory(runsDescriptor, expectedRunId, runDirectory);
    const contents = {
      events: readVerifiedEntry(runDescriptor, "events.jsonl", eventsPath, 64 * 1024 * 1024),
      manifest: readVerifiedEntry(runDescriptor, "manifest.json", manifestPath, 8 * 1024 * 1024),
      result: readVerifiedEntry(runDescriptor, "result.json", resultPath, 8 * 1024 * 1024),
    };
    requireDirectoryIdentity(runDirectory, fstatSync(runDescriptor));
    requireDirectoryIdentity(runsDirectory, fstatSync(runsDescriptor));
    requireDirectoryIdentity(outputRoot, fstatSync(rootDescriptor));
    return contents;
  } finally {
    if (runDescriptor !== undefined) closeSync(runDescriptor);
    if (runsDescriptor !== undefined) closeSync(runsDescriptor);
    closeSync(rootDescriptor);
  }
}

export function readBoundedReplayFile(
  path: string,
  maximumBytes: number = 128 * 1024 * 1024,
): string {
  const resolvedPath = resolve(path);
  const initial = inspectPath(resolvedPath);
  if (!initial.isFile() || initial.isSymbolicLink()) throw new RunArtifactReadError("invalid");
  let descriptor: number;
  try {
    descriptor = openSync(
      resolvedPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    throw mapReadError(error);
  }
  try {
    return readVerifiedDescriptor(descriptor, initial, maximumBytes, false);
  } finally {
    closeSync(descriptor);
  }
}

function openVerifiedDirectory(path: string): number {
  const initial = inspectPath(path);
  if (!initial.isDirectory() || initial.isSymbolicLink()) throw new RunArtifactReadError("invalid");
  let descriptor: number;
  try {
    descriptor = openRetainedDirectory(path);
  } catch {
    throw new RunArtifactReadError("invalid");
  }
  try {
    requireSameIdentity(initial, fstatSync(descriptor));
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function openVerifiedChildDirectory(parentDescriptor: number, name: string, path: string): number {
  const initial = inspectPath(path);
  if (!initial.isDirectory() || initial.isSymbolicLink()) throw new RunArtifactReadError("invalid");
  let descriptor: number;
  try {
    descriptor = openDirectoryEntry(
      parentDescriptor,
      name,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    throw new RunArtifactReadError("invalid");
  }
  try {
    requireSameIdentity(initial, fstatSync(descriptor));
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function readVerifiedEntry(
  directoryDescriptor: number,
  name: string,
  path: string,
  maximumBytes: number,
): string {
  const initial = inspectPath(path);
  if (!initial.isFile() || initial.isSymbolicLink()) throw new RunArtifactReadError("invalid");
  let descriptor: number;
  try {
    descriptor = openDirectoryEntry(
      directoryDescriptor,
      name,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    throw new RunArtifactReadError("invalid");
  }
  try {
    return readVerifiedDescriptor(descriptor, initial, maximumBytes, true);
  } finally {
    closeSync(descriptor);
  }
}

function readVerifiedDescriptor(
  descriptor: number,
  initial: Stats,
  maximumBytes: number,
  requirePrivate: boolean,
): string {
  const before = fstatSync(descriptor);
  requireSameIdentity(initial, before);
  if (!before.isFile() || before.nlink !== 1 || before.size > maximumBytes)
    throw new RunArtifactReadError("invalid");
  const processUserId = process.getuid?.();
  if (
    requirePrivate &&
    (processUserId === undefined ||
      before.uid !== processUserId ||
      (before.mode & 0o7777) !== 0o600)
  ) {
    throw new RunArtifactReadError("invalid");
  }
  const content = readFileSync(descriptor);
  const after = fstatSync(descriptor);
  requireSameIdentity(before, after);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    content.byteLength !== after.size
  )
    throw new RunArtifactReadError("invalid");
  return content.toString("utf8");
}

function requireDirectoryIdentity(path: string, expected: Stats): void {
  const current = inspectPath(path);
  if (!current.isDirectory() || current.isSymbolicLink()) throw new RunArtifactReadError("invalid");
  requireSameIdentity(current, expected);
}

function requireSameIdentity(
  left: { readonly dev: number; readonly ino: number },
  right: { readonly dev: number; readonly ino: number },
): void {
  if (left.dev !== right.dev || left.ino !== right.ino) throw new RunArtifactReadError("invalid");
}

function inspectPath(path: string): Stats {
  try {
    return lstatSync(path) as Stats;
  } catch (error) {
    throw mapReadError(error);
  }
}

function mapReadError(error: unknown): RunArtifactReadError {
  const code =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return new RunArtifactReadError(code === "ENOENT" ? "unavailable" : "invalid");
}

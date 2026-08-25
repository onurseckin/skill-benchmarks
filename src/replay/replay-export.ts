import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  fstatSync,
  mkdirSync,
  readFileSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  openDirectoryEntry,
  replaceDirectoryEntry,
  unlinkDirectoryEntry,
} from "../infrastructure/filesystem/directory-entry-operations.js";
import {
  inspectDirectoryDescriptor,
  openRetainedDirectory,
  requireRetainedDirectoryPath,
} from "../infrastructure/workspace/run-artifact-authority.js";
import { requireDistinctReplayOutput } from "./replay-path-collision.js";

export function writeReplayExportAtomic(
  outputPath: string,
  content: string,
  protectedPaths: readonly string[] = []
): void {
  const resolvedPath = resolve(outputPath);
  const directoryPath = dirname(resolvedPath);
  const targetName = basename(resolvedPath);
  if (targetName.length === 0 || targetName === "." || targetName === "..") throw new TypeError("Replay output path is invalid");
  requireDistinctReplayOutput(resolvedPath, protectedPaths);
  mkdirSync(directoryPath, { recursive: true });
  const directoryDescriptor = openRetainedDirectory(directoryPath);
  const directoryIdentity = inspectDirectoryDescriptor(directoryDescriptor);
  const temporaryName = `.${targetName}.tmp-${randomUUID()}`;
  let temporaryDescriptor: number | undefined;
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
    writeFileSync(temporaryDescriptor, content, "utf8");
    fsyncSync(temporaryDescriptor);
    const temporaryIdentity = fstatSync(temporaryDescriptor);
    requireStableExportFile(temporaryIdentity, content);
    closeSync(temporaryDescriptor);
    temporaryDescriptor = undefined;
    verifyPublishedEntry(directoryDescriptor, temporaryName, temporaryIdentity, content);
    requireRetainedDirectoryPath(directoryPath, directoryIdentity);
    requireDistinctReplayOutput(resolvedPath, protectedPaths);
    replaceDirectoryEntry(directoryDescriptor, temporaryName, targetName);
    temporaryExists = false;
    fsyncSync(directoryDescriptor);
    requireRetainedDirectoryPath(directoryPath, directoryIdentity);
    verifyPublishedEntry(directoryDescriptor, targetName, temporaryIdentity, content);
  } finally {
    if (temporaryDescriptor !== undefined) closeSync(temporaryDescriptor);
    if (temporaryExists) {
      try {
        unlinkDirectoryEntry(directoryDescriptor, temporaryName);
        fsyncSync(directoryDescriptor);
      } catch {}
    }
    closeSync(directoryDescriptor);
  }
}

function verifyPublishedEntry(
  directoryDescriptor: number,
  entryName: string,
  expectedIdentity: Stats,
  content: string
): void {
  const descriptor = openDirectoryEntry(
    directoryDescriptor,
    entryName,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const before = fstatSync(descriptor);
    requireMatchingExportFile(before, expectedIdentity, content);
    if (readFileSync(descriptor, "utf8") !== content) throw new TypeError("Replay export publication changed");
    requireMatchingExportFile(fstatSync(descriptor), before, content);
  } finally {
    closeSync(descriptor);
  }
}

function requireStableExportFile(
  identity: Stats,
  content: string
): void {
  if (
    !identity.isFile()
    || identity.nlink !== 1
    || (identity.mode & 0o7777) !== 0o600
    || identity.size !== Buffer.byteLength(content)
  ) throw new TypeError("Replay export temporary file is unsafe");
}

function requireMatchingExportFile(
  actual: Stats,
  expected: Stats,
  content: string
): void {
  requireStableExportFile(actual, content);
  if (
    actual.dev !== expected.dev
    || actual.ino !== expected.ino
    || actual.size !== expected.size
    || actual.mtimeMs !== expected.mtimeMs
  ) throw new TypeError("Replay export publication changed");
}

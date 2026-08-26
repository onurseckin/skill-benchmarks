import { closeSync, constants, fchmodSync, fstatSync, mkdirSync, writeFileSync } from "node:fs";
import type { RunArtifactLayout } from "../workspace/types.js";
import {
  inspectDirectoryDescriptor,
  openAuthorizedRunDirectory,
  openRetainedDirectory,
  requireRetainedDirectoryPath,
  requireRunArtifactAuthority,
} from "../workspace/run-artifact-authority.js";
import {
  openDirectoryEntry,
  tryOpenDirectoryEntry,
} from "../filesystem/directory-entry-operations.js";

interface ArtifactFileIdentity {
  readonly device: number;
  readonly inode: number;
}

interface OpenArtifactFile extends ArtifactFileIdentity {
  readonly descriptor: number;
  readonly name: string;
}

export class EventArtifactWriter {
  private directoryDescriptor?: number;
  private eventsFile?: OpenArtifactFile;
  private rawLogFile?: OpenArtifactFile;

  public constructor(
    private readonly outputDirectory: string,
    private readonly layout?: RunArtifactLayout,
  ) {}

  public initialize(): void {
    if (this.directoryDescriptor !== undefined) return;
    const directoryDescriptor = this.openDirectory();
    let eventsFile: OpenArtifactFile | undefined;
    let rawLogFile: OpenArtifactFile | undefined;
    try {
      eventsFile = openArtifactFile(directoryDescriptor, "events.jsonl");
      rawLogFile = openArtifactFile(directoryDescriptor, "raw.log");
      this.directoryDescriptor = directoryDescriptor;
      this.eventsFile = eventsFile;
      this.rawLogFile = rawLogFile;
    } catch (error) {
      if (rawLogFile !== undefined) closeSync(rawLogFile.descriptor);
      if (eventsFile !== undefined) closeSync(eventsFile.descriptor);
      closeSync(directoryDescriptor);
      throw error;
    }
  }

  public append(events: string, rawLog: string): void {
    this.initialize();
    const directoryDescriptor = requireValue(this.directoryDescriptor);
    const eventsFile = requireValue(this.eventsFile);
    const rawLogFile = requireValue(this.rawLogFile);
    this.requireDirectoryAuthority(directoryDescriptor);
    requireArtifactFile(directoryDescriptor, eventsFile);
    requireArtifactFile(directoryDescriptor, rawLogFile);
    if (events.length > 0) writeFileSync(eventsFile.descriptor, events, "utf8");
    if (rawLog.length > 0) writeFileSync(rawLogFile.descriptor, rawLog, "utf8");
  }

  public close(): void {
    if (this.rawLogFile !== undefined) closeSync(this.rawLogFile.descriptor);
    if (this.eventsFile !== undefined) closeSync(this.eventsFile.descriptor);
    if (this.directoryDescriptor !== undefined) closeSync(this.directoryDescriptor);
    this.rawLogFile = undefined;
    this.eventsFile = undefined;
    this.directoryDescriptor = undefined;
  }

  private openDirectory(): number {
    if (this.layout !== undefined) return openAuthorizedRunDirectory(this.layout);
    mkdirSync(this.outputDirectory, { recursive: true });
    return openRetainedDirectory(this.outputDirectory);
  }

  private requireDirectoryAuthority(directoryDescriptor: number): void {
    if (this.layout !== undefined) {
      requireRunArtifactAuthority(this.layout);
      const expected = this.layout.authority?.runDirectory;
      if (expected === undefined)
        throw new TypeError("Benchmark artifact directory authority is missing");
      requireIdentity(inspectDirectoryDescriptor(directoryDescriptor), expected);
      return;
    }
    const identity = inspectDirectoryDescriptor(directoryDescriptor);
    requireRetainedDirectoryPath(this.outputDirectory, identity);
  }
}

function openArtifactFile(directoryDescriptor: number, name: string): OpenArtifactFile {
  const appendFlags =
    constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  let descriptor = tryOpenDirectoryEntry(directoryDescriptor, name, appendFlags);
  const created = descriptor === undefined;
  if (created) {
    const createdDescriptor = openDirectoryEntry(
      directoryDescriptor,
      name,
      appendFlags | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    fchmodSync(createdDescriptor, 0o600);
    descriptor = createdDescriptor;
  }
  if (descriptor === undefined) throw new TypeError("Benchmark event artifact is unavailable");
  try {
    const identity = inspectArtifactFile(descriptor);
    return { descriptor, name, ...identity };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function requireArtifactFile(directoryDescriptor: number, expected: OpenArtifactFile): void {
  requireIdentity(inspectArtifactFile(expected.descriptor), expected);
  const currentDescriptor = openDirectoryEntry(
    directoryDescriptor,
    expected.name,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    requireIdentity(inspectArtifactFile(currentDescriptor), expected);
  } finally {
    closeSync(currentDescriptor);
  }
}

function inspectArtifactFile(descriptor: number): ArtifactFileIdentity {
  const stats = fstatSync(descriptor);
  const processUserId = process.getuid?.();
  if (
    !stats.isFile() ||
    stats.nlink !== 1 ||
    processUserId === undefined ||
    stats.uid !== processUserId ||
    (stats.mode & 0o7777) !== 0o600
  ) {
    throw new TypeError("Benchmark event artifact is unsafe");
  }
  return { device: stats.dev, inode: stats.ino };
}

function requireIdentity(actual: ArtifactFileIdentity, expected: ArtifactFileIdentity): void {
  if (actual.device !== expected.device || actual.inode !== expected.inode) {
    throw new TypeError("Benchmark event artifact authority changed");
  }
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new TypeError("Benchmark event artifact is unavailable");
  return value;
}

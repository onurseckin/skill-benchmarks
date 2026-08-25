import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export function writeCheckpointSnapshot(filePath: string, serialized: string, maxBackups: number): void {
  const parentDirectory = dirname(filePath);
  mkdirSync(parentDirectory, { recursive: true });
  removeCheckpointTemporaryFiles(filePath);
  validateCheckpointTarget(filePath);
  if (existsSync(filePath) && maxBackups > 0) preserveCheckpointBackup(filePath);
  const temporaryPath = join(parentDirectory, `.${basename(filePath)}.${randomUUID()}.tmp`);
  try {
    writeDurableFile(temporaryPath, serialized);
    validateCheckpointTarget(filePath);
    renameSync(temporaryPath, filePath);
    syncDirectory(parentDirectory);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

export function removeCheckpointTemporaryFiles(filePath: string): void {
  inspectCheckpointTemporaryFiles(filePath, true);
}

export function validateCheckpointTemporaryFiles(filePath: string): void {
  inspectCheckpointTemporaryFiles(filePath, false);
}

function inspectCheckpointTemporaryFiles(filePath: string, remove: boolean): void {
  const parentDirectory = dirname(filePath);
  if (!existsSync(parentDirectory)) return;
  const escapedName = escapeRegularExpression(basename(filePath));
  const currentPattern = new RegExp(`^\\.${escapedName}\\.[0-9a-f-]{36}\\.tmp$`);
  const legacyPattern = new RegExp(`^${escapedName}\\.tmp\\.[0-9]+\\.[a-z0-9]{1,16}$`);
  for (const entry of readdirSync(parentDirectory)) {
    if (!currentPattern.test(entry) && !legacyPattern.test(entry)) continue;
    const path = join(parentDirectory, entry);
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new TypeError("Checkpoint temporary artifact is unsafe");
    if (remove) unlinkSync(path);
  }
}

function preserveCheckpointBackup(filePath: string): void {
  const backupPath = `${filePath}.bak.1`;
  if (existsSync(backupPath)) {
    const stats = lstatSync(backupPath);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new TypeError("Checkpoint backup target is unsafe");
    return;
  }
  const temporaryPath = `${backupPath}.${randomUUID()}.tmp`;
  try {
    writeDurableFile(temporaryPath, readFileSync(filePath, "utf8"));
    linkSync(temporaryPath, backupPath);
    syncDirectory(dirname(filePath));
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function validateCheckpointTarget(filePath: string): void {
  if (!existsSync(filePath)) return;
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new TypeError("Checkpoint target is unsafe");
}

function writeDurableFile(path: string, content: string): void {
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

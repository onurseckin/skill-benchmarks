import { randomUUID } from "node:crypto";
import { closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { Stats } from "node:fs";
import { basename, dirname, join, parse, resolve } from "node:path";

export interface ReportOutput {
  readonly path: string;
  readonly content: string;
}

export function publishReportOutputs(outputs: readonly ReportOutput[], protectedPaths: readonly string[]): void {
  const resolvedOutputs = outputs.map((output) => ({ ...output, path: resolve(output.path) }));
  preflightReportOutputPaths(resolvedOutputs.map((output) => output.path), protectedPaths);
  const temporaryOutputs: MutableTemporaryOutput[] = [];
  try {
    for (const output of resolvedOutputs) temporaryOutputs.push(createTemporaryOutput(output));
    validateOutputTargets(resolvedOutputs);
    for (const output of temporaryOutputs) validateTemporaryOutput(output);
    for (const output of temporaryOutputs) {
      renameSync(output.temporaryPath, output.path);
      syncDirectory(dirname(output.path));
      output.published = true;
    }
  } finally {
    for (const output of temporaryOutputs) {
      if (!output.published) unlinkOwnedTemporaryOutput(output);
    }
  }
}

export function preflightReportOutputPaths(outputPaths: readonly string[], protectedPaths: readonly string[]): void {
  const resolvedOutputs = outputPaths.map((path) => ({ path: resolve(path), content: "" }));
  requireDistinctPaths(resolvedOutputs.map((output) => output.path), protectedPaths.map((path) => resolve(path)));
  validateOutputTargets(resolvedOutputs);
}

function createTemporaryOutput(output: ReportOutput & { readonly path: string }): MutableTemporaryOutput {
  const parent = dirname(output.path);
  const name = basename(output.path);
  const temporaryPath = resolve(parent, `.${name}.${randomUUID()}.tmp`);
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  let descriptorOpen = true;
  let identity: MutableTemporaryOutput["identity"] | undefined;
  try {
    writeFileSync(descriptor, output.content, "utf8");
    fsyncSync(descriptor);
    const stats = fstatSync(descriptor);
    const currentUserId = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (!stats.isFile() || stats.nlink !== 1 || currentUserId === undefined || stats.uid !== currentUserId
      || (stats.mode & 0o7777) !== 0o600) throw new TypeError("Report temporary output is unsafe");
    identity = { device: stats.dev, inode: stats.ino, size: stats.size, modifiedAtMs: stats.mtimeMs };
  } catch (error) {
    closeSync(descriptor);
    descriptorOpen = false;
    unlinkSync(temporaryPath);
    throw error;
  } finally {
    if (descriptorOpen) closeSync(descriptor);
  }
  if (identity === undefined) throw new TypeError("Report temporary output is unsafe");
  return { path: output.path, temporaryPath, identity, published: false };
}

function validateOutputTargets(outputs: readonly (ReportOutput & { readonly path: string })[]): void {
  for (const output of outputs) {
    const parent = dirname(output.path);
    const name = basename(output.path);
    if (name.length === 0 || name === "." || name === "..") throw new TypeError("Report output path is invalid");
    validateOutputAncestorChain(parent);
    mkdirSync(parent, { recursive: true });
    validateOutputAncestorChain(parent, true);
    const stats = inspectPathEntry(output.path);
    if (stats === undefined) continue;
    const currentUserId = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1
      || currentUserId === undefined || stats.uid !== currentUserId || (stats.mode & 0o7777) !== 0o600) {
      throw new TypeError("Report output target is unsafe");
    }
  }
}

function validateTemporaryOutput(output: MutableTemporaryOutput): void {
  const stats = inspectPathEntry(output.temporaryPath);
  const currentUserId = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (stats === undefined || !stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1
    || currentUserId === undefined || stats.uid !== currentUserId || (stats.mode & 0o7777) !== 0o600
    || stats.dev !== output.identity.device || stats.ino !== output.identity.inode
    || stats.size !== output.identity.size || stats.mtimeMs !== output.identity.modifiedAtMs) {
    throw new TypeError("Report temporary output is unsafe");
  }
}

function unlinkOwnedTemporaryOutput(output: MutableTemporaryOutput): void {
  const stats = inspectPathEntry(output.temporaryPath);
  if (stats !== undefined && stats.dev === output.identity.device && stats.ino === output.identity.inode) {
    unlinkSync(output.temporaryPath);
  }
}

function validateOutputAncestorChain(path: string, requireComplete: boolean = false): void {
  const resolvedPath = resolve(path);
  const pathRoot = parse(resolvedPath).root;
  const segments = resolvedPath.slice(pathRoot.length).split(/[\\/]+/).filter(Boolean);
  let currentPath = pathRoot;
  for (const segment of segments) {
    currentPath = join(currentPath, segment);
    let stats;
    try {
      stats = lstatSync(currentPath);
    } catch (error) {
      if (!requireComplete && isMissingPath(error)) return;
      throw new TypeError("Report output parent is unsafe");
    }
    if (stats.isSymbolicLink()) {
      if (dirname(currentPath) !== pathRoot || stats.uid !== 0 || !statSync(currentPath).isDirectory()) {
        throw new TypeError("Report output parent is unsafe");
      }
    } else if (!stats.isDirectory()) {
      throw new TypeError("Report output parent is unsafe");
    }
  }
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function requireDistinctPaths(outputPaths: readonly string[], protectedPaths: readonly string[]): void {
  const allPaths = [...outputPaths, ...protectedPaths];
  for (let leftIndex = 0; leftIndex < allPaths.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < allPaths.length; rightIndex++) {
      const left = allPaths[leftIndex] as string;
      const right = allPaths[rightIndex] as string;
      if (left.toLocaleLowerCase() === right.toLocaleLowerCase() || sameExistingFile(left, right)) {
        throw new TypeError("Report output conflicts with a protected path");
      }
    }
  }
}

function sameExistingFile(left: string, right: string): boolean {
  const leftStats = inspectPathEntry(left);
  const rightStats = inspectPathEntry(right);
  if (leftStats === undefined || rightStats === undefined) return false;
  return leftStats.dev === rightStats.dev && leftStats.ino === rightStats.ino;
}

function inspectPathEntry(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isMissingPath(error)) return undefined;
    throw error;
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

interface MutableTemporaryOutput {
  readonly path: string;
  readonly temporaryPath: string;
  readonly identity: {
    readonly device: number;
    readonly inode: number;
    readonly size: number;
    readonly modifiedAtMs: number;
  };
  published: boolean;
}

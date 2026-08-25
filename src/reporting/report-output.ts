import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export interface ReportOutput {
  readonly path: string;
  readonly content: string;
}

export function publishReportOutputs(outputs: readonly ReportOutput[], protectedPaths: readonly string[]): void {
  const resolvedOutputs = outputs.map((output) => ({ ...output, path: resolve(output.path) }));
  requireDistinctPaths(resolvedOutputs.map((output) => output.path), protectedPaths.map((path) => resolve(path)));
  validateOutputTargets(resolvedOutputs);
  const temporaryOutputs: MutableTemporaryOutput[] = [];
  try {
    for (const output of resolvedOutputs) temporaryOutputs.push(createTemporaryOutput(output));
    for (const output of temporaryOutputs) {
      renameSync(output.temporaryPath, output.path);
      syncDirectory(dirname(output.path));
      output.published = true;
    }
  } finally {
    for (const output of temporaryOutputs) {
      if (!output.published && existsSync(output.temporaryPath)) unlinkSync(output.temporaryPath);
    }
  }
}

function createTemporaryOutput(output: ReportOutput & { readonly path: string }): MutableTemporaryOutput {
  const parent = dirname(output.path);
  const name = basename(output.path);
  const temporaryPath = resolve(parent, `.${name}.${randomUUID()}.tmp`);
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  let descriptorOpen = true;
  try {
    writeFileSync(descriptor, output.content, "utf8");
    fsyncSync(descriptor);
  } catch (error) {
    closeSync(descriptor);
    descriptorOpen = false;
    unlinkSync(temporaryPath);
    throw error;
  } finally {
    if (descriptorOpen) closeSync(descriptor);
  }
  return { path: output.path, temporaryPath, published: false };
}

function validateOutputTargets(outputs: readonly (ReportOutput & { readonly path: string })[]): void {
  for (const output of outputs) {
    const parent = dirname(output.path);
    const name = basename(output.path);
    if (name.length === 0 || name === "." || name === "..") throw new TypeError("Report output path is invalid");
    mkdirSync(parent, { recursive: true });
    if (!existsSync(output.path)) continue;
    const stats = lstatSync(output.path);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) throw new TypeError("Report output target is unsafe");
  }
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
  if (!existsSync(left) || !existsSync(right)) return false;
  const leftStats = lstatSync(left);
  const rightStats = lstatSync(right);
  return leftStats.dev === rightStats.dev && leftStats.ino === rightStats.ino;
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
  published: boolean;
}

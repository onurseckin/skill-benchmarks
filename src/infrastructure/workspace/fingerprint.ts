import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { FingerprintOptions, PreRunFingerprintManifest } from "./types.js";

export const DEFAULT_FINGERPRINT_IGNORES: ReadonlyArray<string> = [
  ".git",
  ".DS_Store",
  "node_modules",
  ".benchmarks",
];

export function computeBufferSha256(buffer: Uint8Array): string {
  const hash = createHash("sha256");
  hash.update(buffer);
  return hash.digest("hex");
}

export async function computeFileSha256(filePath: string): Promise<string> {
  const absolutePath = resolve(filePath);
  const content = await readFile(absolutePath);
  return computeBufferSha256(content);
}

function shouldIgnorePath(
  relPath: string,
  fileName: string,
  ignorePatterns: ReadonlyArray<string | RegExp>,
): boolean {
  const normalizedRel = relPath.replace(/\\/g, "/");
  const pathSegments = normalizedRel.split("/");

  for (const pattern of ignorePatterns) {
    if (typeof pattern === "string") {
      if (fileName === pattern || pathSegments.includes(pattern)) {
        return true;
      }
      if (normalizedRel === pattern || normalizedRel.startsWith(`${pattern}/`)) {
        return true;
      }
    } else if (pattern instanceof RegExp) {
      if (pattern.test(normalizedRel) || pattern.test(fileName)) {
        return true;
      }
    }
  }

  return false;
}

async function collectFiles(
  dirPath: string,
  baseDir: string,
  ignorePatterns: ReadonlyArray<string | RegExp>,
  includeHidden: boolean,
): Promise<ReadonlyArray<string>> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const collected: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    const relPath = relative(baseDir, fullPath).replace(/\\/g, "/");

    if (shouldIgnorePath(relPath, entry.name, ignorePatterns)) {
      continue;
    }

    if (entry.isDirectory()) {
      const subFiles = await collectFiles(fullPath, baseDir, ignorePatterns, includeHidden);
      collected.push(...subFiles);
    } else if (entry.isFile()) {
      collected.push(fullPath);
    } else if (entry.isSymbolicLink()) {
      try {
        const linkStat = await stat(fullPath);
        if (linkStat.isFile()) {
          collected.push(fullPath);
        }
      } catch {}
    }
  }

  return collected;
}

export async function generateWorkspaceFingerprint(
  workspaceDir: string,
  options: FingerprintOptions = {},
): Promise<PreRunFingerprintManifest> {
  const rootDir = resolve(workspaceDir);
  const ignorePatterns = options.ignorePatterns ?? DEFAULT_FINGERPRINT_IGNORES;
  const includeHidden = options.includeHidden ?? true;
  const runId = options.runId ?? `run-${Date.now()}`;
  const scenarioId = options.scenarioId ?? "unknown-scenario";

  const allFilePaths = await collectFiles(rootDir, rootDir, ignorePatterns, includeHidden);

  const fileEntries: Array<[string, string]> = [];

  for (const filePath of allFilePaths) {
    const relPath = relative(rootDir, filePath).replace(/\\/g, "/");
    const hash = await computeFileSha256(filePath);
    fileEntries.push([relPath, hash]);
  }

  fileEntries.sort((a, b) => a[0].localeCompare(b[0]));

  const filesMap: Record<string, string> = {};
  for (const [path, hash] of fileEntries) {
    filesMap[path] = hash;
  }

  return {
    runId,
    scenarioId,
    timestamp: new Date().toISOString(),
    fileCount: fileEntries.length,
    files: filesMap,
  };
}

export interface FingerprintDiff {
  readonly added: ReadonlyArray<string>;
  readonly modified: ReadonlyArray<string>;
  readonly deleted: ReadonlyArray<string>;
  readonly unchanged: ReadonlyArray<string>;
}

export function diffFingerprints(
  before: PreRunFingerprintManifest,
  after: PreRunFingerprintManifest,
): FingerprintDiff {
  const beforeKeys = new Set(Object.keys(before.files));
  const afterKeys = new Set(Object.keys(after.files));

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const unchanged: string[] = [];

  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) {
      added.push(key);
    } else {
      const beforeHash = before.files[key];
      const afterHash = after.files[key];
      if (beforeHash === afterHash) {
        unchanged.push(key);
      } else {
        modified.push(key);
      }
    }
  }

  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) {
      deleted.push(key);
    }
  }

  added.sort();
  modified.sort();
  deleted.sort();
  unchanged.sort();

  return {
    added,
    modified,
    deleted,
    unchanged,
  };
}

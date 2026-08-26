import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export function sanitizeSkillId(source: string): string {
  let cleaned = source;
  if (cleaned.startsWith("https://")) cleaned = cleaned.slice(8);
  else if (cleaned.startsWith("http://")) cleaned = cleaned.slice(7);
  if (cleaned.startsWith("git@github.com:")) cleaned = cleaned.slice(15);
  if (cleaned.endsWith(".git")) cleaned = cleaned.slice(0, -4);
  return cleaned.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function computeSha256(data: string | Uint8Array): string {
  const hasher = createHash("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

export async function findManifestFile(directoryPath: string): Promise<string | null> {
  try {
    const fileStats = await stat(directoryPath);
    if (fileStats.isFile()) return directoryPath;
  } catch {
    return null;
  }
  const primaryNames = ["SKILL.md", "skill.md", "README.md", "manifest.json", "skill.json"];
  for (const name of primaryNames) {
    const candidate = join(directoryPath, name);
    try {
      const candidateStats = await stat(candidate);
      if (candidateStats.isFile()) return candidate;
    } catch {
      continue;
    }
  }
  const ignoredDirectories = new Set([".git", "node_modules", ".benchmarks", "dist"]);
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) continue;
        const nestedManifest = await findManifestFile(join(directoryPath, entry.name));
        if (nestedManifest !== null) return nestedManifest;
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        return join(directoryPath, entry.name);
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function isCacheFresh(
  cachedPath: string,
  ttlMs?: number,
  expectedHash?: string,
): Promise<boolean> {
  try {
    const fileStats = await stat(cachedPath);
    if (ttlMs !== undefined && ttlMs > 0 && Date.now() - fileStats.mtimeMs > ttlMs) return false;
    if (expectedHash !== undefined && expectedHash.length > 0) {
      const manifestFile = await findManifestFile(cachedPath);
      if (manifestFile === null) return false;
      const content = await readFile(manifestFile, "utf-8");
      if (computeSha256(content) !== expectedHash) return false;
    }
    return true;
  } catch {
    return false;
  }
}

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogEntry, SkillManifest, SkillSourceType } from "./types.js";

export class SkillResolutionError extends TypeError {
  readonly code = "skill_unresolved";

  constructor() {
    super("Requested skill is unavailable");
    this.name = "SkillResolutionError";
  }
}

export function normalizeSkillId(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

export async function collectSkillFilePaths(dirPath: string): Promise<string[]> {
  const result: string[] = [];
  try {
    const dirStats = await stat(dirPath);
    if (dirStats.isFile()) {
      if (dirPath.endsWith(".md") || dirPath.endsWith(".json")) result.push(dirPath);
      return result;
    }
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".benchmarks" || entry.name === "dist") continue;
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) result.push(...(await collectSkillFilePaths(fullPath)));
      else if (entry.isFile() && (entry.name === "SKILL.md" || entry.name === "skill.md" || entry.name.endsWith(".skill.md") || entry.name === "skill.json")) result.push(fullPath);
    }
  } catch {
    return result;
  }
  return result;
}

export function calculateSkillScore(manifest: SkillManifest, tokens: readonly string[]): number {
  let score = 0;
  const name = manifest.name.toLowerCase();
  const description = manifest.description.toLowerCase();
  const category = manifest.category.toLowerCase();
  const tags = manifest.tags.map((tag) => tag.toLowerCase());
  for (const token of tokens) {
    if (name === token) score += 20;
    else if (name.includes(token)) score += 10;
    if (tags.includes(token)) score += 6;
    else if (tags.some((tag) => tag.includes(token))) score += 3;
    if (category.includes(token)) score += 4;
    if (description.includes(token)) score += 2;
    if (manifest.rules.some((rule) => rule.title.toLowerCase().includes(token) || rule.description.toLowerCase().includes(token))) score += 1;
    if (manifest.tools.some((tool) => tool.name.toLowerCase().includes(token) || tool.description.toLowerCase().includes(token))) score += 1;
  }
  return score;
}

export function createCatalogEntry(
  id: string,
  manifest: SkillManifest,
  data: Partial<CatalogEntry> | undefined,
  existing: CatalogEntry | undefined
): CatalogEntry {
  const source = data?.source ?? existing?.source ?? manifest.repository ?? manifest.name;
  const sourceType: SkillSourceType = data?.sourceType ?? existing?.sourceType ?? "local";
  return {
    id,
    name: manifest.name,
    category: manifest.category,
    source,
    sourceType,
    description: manifest.description,
    version: manifest.version,
    tags: manifest.tags,
    manifest,
    status: "valid",
    installs: data?.installs ?? existing?.installs ?? 0,
    installsDisplay: data?.installsDisplay ?? existing?.installsDisplay,
    updatedAt: new Date().toISOString(),
  };
}

export function requireSubstantiveSkillManifest(manifest: SkillManifest | undefined): SkillManifest {
  if (manifest === undefined) throw new SkillResolutionError();
  const hasIdentity = manifest.name.trim().length > 0
    && manifest.version.trim().length > 0
    && manifest.description.trim().length > 0
    && manifest.category.trim().length > 0;
  const hasInstructions = manifest.guidelines.some((value) => value.trim().length > 0)
    || manifest.rules.length > 0
    || manifest.tools.length > 0
    || manifest.scripts.length > 0
    || (manifest.promptTemplate?.trim().length ?? 0) > 0
    || (manifest.rawContent?.trim().length ?? 0) > 0;
  if (!hasIdentity || !hasInstructions) throw new SkillResolutionError();
  return manifest;
}

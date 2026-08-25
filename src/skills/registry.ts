import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import type {
  SkillCategory,
  CanonicalSkillDomain,
  CanonicalSkill,
  SkillManifest,
  CatalogEntry,
  SkillFilterOptions,
  SkillPromptFormatOptions,
  SkillSourceType,
} from "./types";
import { CANONICAL_SKILLS } from "./canonical";
import { parseCatalogMarkdown, parseInstallsCount } from "./catalog-parser";
import { formatSkillPrompt, formatSkillsForAgentContext } from "./formatter";
import { parseSkillFile } from "./parser";
import { validateSkillManifest } from "./validator";

export { CANONICAL_SKILLS } from "./canonical";
export { parseCatalogMarkdown, parseInstallsCount } from "./catalog-parser";
export { formatSkillPrompt, formatSkillsForAgentContext } from "./formatter";

function normalizeSkillId(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

async function collectSkillFilePaths(dirPath: string): Promise<string[]> {
  const result: string[] = [];
  try {
    const dirStats = await stat(dirPath);
    if (dirStats.isFile()) {
      if (dirPath.endsWith(".md") || dirPath.endsWith(".json")) result.push(dirPath);
      return result;
    }
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === ".git" || e.name === "node_modules" || e.name === ".benchmarks" || e.name === "dist") continue;
      const full = join(dirPath, e.name);
      if (e.isDirectory()) result.push(...(await collectSkillFilePaths(full)));
      else if (e.isFile() && (e.name === "SKILL.md" || e.name === "skill.md" || e.name.endsWith(".skill.md") || e.name === "skill.json")) result.push(full);
    }
  } catch {
    return result;
  }
  return result;
}

function calculateSkillScore(m: SkillManifest, tokens: readonly string[]): number {
  let score = 0;
  const name = m.name.toLowerCase();
  const desc = m.description.toLowerCase();
  const cat = m.category.toLowerCase();
  const tags = m.tags.map((t) => t.toLowerCase());
  for (const tok of tokens) {
    if (name === tok) score += 20;
    else if (name.includes(tok)) score += 10;
    if (tags.includes(tok)) score += 6;
    else if (tags.some((t) => t.includes(tok))) score += 3;
    if (cat.includes(tok)) score += 4;
    if (desc.includes(tok)) score += 2;
    if (m.rules.some((r) => r.title.toLowerCase().includes(tok) || r.description.toLowerCase().includes(tok))) score += 1;
    if (m.tools.some((t) => t.name.toLowerCase().includes(tok) || t.description.toLowerCase().includes(tok))) score += 1;
  }
  return score;
}

export class SkillRegistry {
  private readonly skills: Map<string, SkillManifest> = new Map();
  private readonly catalog: Map<string, CatalogEntry> = new Map();
  private readonly canonical: Map<string, CanonicalSkill> = new Map();
  private readonly categoryIndex: Map<string, Set<string>> = new Map();
  private readonly domainIndex: Map<string, Set<string>> = new Map();
  private readonly tagIndex: Map<string, Set<string>> = new Map();

  constructor(preloadCanonical = true) {
    if (preloadCanonical) {
      this.loadCanonicalSkills();
    }
  }

  private index(map: Map<string, Set<string>>, key: string, id: string): void {
    const k = key.toLowerCase();
    const existing = map.get(k);
    const set = existing !== undefined ? existing : new Set<string>();
    set.add(id);
    map.set(k, set);
  }

  loadCanonicalSkills(): void {
    for (const skill of CANONICAL_SKILLS) {
      this.canonical.set(skill.id, skill);
      this.index(this.domainIndex, skill.domain, skill.id);
      this.index(this.categoryIndex, skill.category, skill.id);
      for (const tag of skill.tags) this.index(this.tagIndex, tag, skill.id);
      this.catalog.set(skill.id, {
        id: skill.id,
        name: skill.name,
        category: skill.category,
        domain: skill.domain,
        source: skill.source,
        sourceType: skill.sourceType,
        author: skill.author,
        installs: skill.installs.rawInstalls,
        installsDisplay: skill.installs.display,
        description: skill.description,
        tags: skill.tags,
        status: skill.status,
      });
    }
  }

  getCanonicalSkills(): readonly CanonicalSkill[] {
    return Array.from(this.canonical.values());
  }

  getCanonicalSkill(id: string): CanonicalSkill | undefined {
    const norm = normalizeSkillId(id);
    return this.canonical.get(norm);
  }

  getSkillsByDomain(domain: CanonicalSkillDomain): readonly CanonicalSkill[] {
    const idSet = this.domainIndex.get(domain.toLowerCase());
    if (idSet === undefined) return [];
    const result: CanonicalSkill[] = [];
    for (const id of idSet) {
      const s = this.canonical.get(id);
      if (s !== undefined) result.push(s);
    }
    return result;
  }

  getCanonicalSkillMap(): ReadonlyMap<string, CanonicalSkill> {
    return new Map(this.canonical);
  }

  registerSkill(manifest: SkillManifest, data?: Partial<CatalogEntry>): CatalogEntry {
    const id = normalizeSkillId(manifest.name);
    this.skills.set(id, manifest);
    this.index(this.categoryIndex, manifest.category, id);
    for (const tag of manifest.tags) this.index(this.tagIndex, tag, id);
    const existing = this.catalog.get(id);
    const resolvedSource = data?.source !== undefined ? data.source : existing?.source !== undefined ? existing.source : manifest.repository !== undefined ? manifest.repository : manifest.name;
    const resolvedType: SkillSourceType = data?.sourceType !== undefined ? data.sourceType : existing?.sourceType !== undefined ? existing.sourceType : "local";
    const resolvedInstalls = data?.installs !== undefined ? data.installs : existing?.installs !== undefined ? existing.installs : 0;
    const resolvedDisplay = data?.installsDisplay !== undefined ? data.installsDisplay : existing?.installsDisplay;
    const entry: CatalogEntry = {
      id,
      name: manifest.name,
      category: manifest.category,
      source: resolvedSource,
      sourceType: resolvedType,
      description: manifest.description,
      version: manifest.version,
      tags: manifest.tags,
      manifest,
      status: "valid",
      installs: resolvedInstalls,
      installsDisplay: resolvedDisplay,
      updatedAt: new Date().toISOString(),
    };
    this.catalog.set(id, entry);
    return entry;
  }

  registerCatalogEntry(entry: CatalogEntry): void {
    const id = normalizeSkillId(entry.id.length > 0 ? entry.id : entry.name);
    this.catalog.set(id, entry);
    if (entry.manifest !== undefined) this.skills.set(id, entry.manifest);
    this.index(this.categoryIndex, entry.category, id);
    if (entry.domain !== undefined) this.index(this.domainIndex, entry.domain, id);
    if (entry.tags !== undefined) {
      for (const tag of entry.tags) this.index(this.tagIndex, tag, id);
    }
  }

  async loadFromDirectory(dirPath: string): Promise<readonly SkillManifest[]> {
    const filePaths = await collectSkillFilePaths(dirPath);
    const loaded: SkillManifest[] = [];
    for (const fp of filePaths) {
      try {
        const m = await parseSkillFile(fp);
        const v = validateSkillManifest(m);
        if (v.valid && v.securityPass) {
          this.registerSkill(m, { manifestPath: fp, cachedPath: dirname(fp) });
          loaded.push(m);
        }
      } catch {}
    }
    return loaded;
  }

  async loadCatalog(catalogPath: string): Promise<readonly CatalogEntry[]> {
    const content = await readFile(catalogPath, "utf-8");
    if (catalogPath.endsWith(".json")) {
      const parsed = JSON.parse(content);
      const items: CatalogEntry[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed.entries) ? parsed.entries : [];
      for (const item of items) this.registerCatalogEntry(item);
    } else {
      const parsedEntries = parseCatalogMarkdown(content);
      for (const entry of parsedEntries) this.registerCatalogEntry(entry);
    }
    return this.getCatalogEntries();
  }

  async saveCatalog(catalogPath: string): Promise<void> {
    const resolvedPath = resolve(catalogPath);
    await mkdir(dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, JSON.stringify(this.getCatalogEntries(), null, 2), "utf-8");
  }

  getCatalogEntries(): readonly CatalogEntry[] {
    return Array.from(this.catalog.values());
  }

  getCatalogEntry(id: string): CatalogEntry | undefined {
    const normalized = normalizeSkillId(id);
    const directMatch = this.catalog.get(normalized);
    if (directMatch !== undefined) return directMatch;
    for (const entry of this.catalog.values()) {
      if (entry.name.toLowerCase() === id.toLowerCase()) return entry;
    }
    return undefined;
  }

  getSkill(id: string): SkillManifest | undefined {
    const normalized = normalizeSkillId(id);
    const directSkill = this.skills.get(normalized);
    if (directSkill !== undefined) return directSkill;
    const catalogItem = this.catalog.get(normalized);
    if (catalogItem !== undefined && catalogItem.manifest !== undefined) return catalogItem.manifest;
    for (const manifest of this.skills.values()) {
      if (manifest.name.toLowerCase() === id.toLowerCase()) return manifest;
    }
    return undefined;
  }

  hasSkill(id: string): boolean {
    return this.getSkill(id) !== undefined || this.canonical.has(normalizeSkillId(id));
  }

  getSkillsByCategory(category: SkillCategory): readonly SkillManifest[] {
    const idSet = this.categoryIndex.get(category.toLowerCase());
    if (idSet === undefined) return [];
    const result: SkillManifest[] = [];
    for (const id of idSet) {
      const skill = this.getSkill(id);
      if (skill !== undefined) result.push(skill);
    }
    return result;
  }

  listSkills(options?: SkillFilterOptions): readonly SkillManifest[] {
    const all = Array.from(this.skills.values());
    if (options === undefined) return all;
    return all.filter((m) => {
      const id = normalizeSkillId(m.name);
      if (options.category !== undefined && m.category.toLowerCase() !== options.category.toLowerCase()) return false;
      if (options.tags !== undefined && options.tags.length > 0) {
        const lower = m.tags.map((t) => t.toLowerCase());
        if (!options.tags.every((t) => lower.includes(t.toLowerCase()))) return false;
      }
      if (options.minInstalls !== undefined && options.minInstalls > 0) {
        const entry = this.catalog.get(id);
        const count = entry !== undefined && entry.installs !== undefined ? entry.installs : 0;
        if (count < options.minInstalls) return false;
      }
      if (options.status !== undefined && options.status.length > 0) {
        const entry = this.catalog.get(id);
        if (entry === undefined || entry.status !== options.status) return false;
      }
      if (options.searchQuery !== undefined && options.searchQuery.length > 0) {
        const q = options.searchQuery.toLowerCase();
        if (!m.name.toLowerCase().includes(q) && !m.description.toLowerCase().includes(q) && !m.category.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  searchSkills(query: string, options?: SkillFilterOptions): readonly SkillManifest[] {
    const q = query.trim();
    if (q.length === 0) return this.listSkills(options);
    const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
    return this.listSkills(options)
      .map((m) => ({ m, score: calculateSkillScore(m, tokens) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.m);
  }

  searchCanonicalSkills(query: string): readonly CanonicalSkill[] {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return this.getCanonicalSkills();
    const tokens = q.split(/\s+/).filter((t) => t.length > 0);
    return this.getCanonicalSkills().filter((skill) => {
      const target = `${skill.id} ${skill.name} ${skill.domain} ${skill.category} ${skill.description} ${skill.tags.join(" ")}`.toLowerCase();
      return tokens.every((tok) => target.includes(tok));
    });
  }

  formatSkillPrompt(manifestOrId: SkillManifest | string, options?: SkillPromptFormatOptions): string {
    return formatSkillPrompt(manifestOrId, options, this);
  }

  formatSkillsForAgentContext(manifestsOrIds: ReadonlyArray<SkillManifest | string>, options?: SkillPromptFormatOptions): string {
    return formatSkillsForAgentContext(manifestsOrIds, options, this);
  }

  clear(): void {
    this.skills.clear();
    this.catalog.clear();
    this.canonical.clear();
    this.categoryIndex.clear();
    this.domainIndex.clear();
    this.tagIndex.clear();
  }

  size(): number {
    return this.skills.size;
  }
}

export const defaultSkillRegistry = new SkillRegistry();
export const getCanonicalSkill = (id: string): CanonicalSkill | undefined => defaultSkillRegistry.getCanonicalSkill(id);
export const getCanonicalSkills = (): readonly CanonicalSkill[] => defaultSkillRegistry.getCanonicalSkills();
export const getSkillsByDomain = (d: CanonicalSkillDomain): readonly CanonicalSkill[] => defaultSkillRegistry.getSkillsByDomain(d);
export const searchCanonicalSkills = (q: string): readonly CanonicalSkill[] => defaultSkillRegistry.searchCanonicalSkills(q);
export const registerSkill = (m: SkillManifest, d?: Partial<CatalogEntry>): CatalogEntry => defaultSkillRegistry.registerSkill(m, d);
export const registerCatalogEntry = (e: CatalogEntry): void => defaultSkillRegistry.registerCatalogEntry(e);
export const loadSkillsFromDirectory = (p: string): Promise<readonly SkillManifest[]> => defaultSkillRegistry.loadFromDirectory(p);
export const loadSkillCatalog = (p: string): Promise<readonly CatalogEntry[]> => defaultSkillRegistry.loadCatalog(p);
export const saveSkillCatalog = (p: string): Promise<void> => defaultSkillRegistry.saveCatalog(p);
export const getCatalogEntries = (): readonly CatalogEntry[] => defaultSkillRegistry.getCatalogEntries();
export const getSkill = (id: string): SkillManifest | undefined => defaultSkillRegistry.getSkill(id);
export const hasSkill = (id: string): boolean => defaultSkillRegistry.hasSkill(id);
export const listSkills = (o?: SkillFilterOptions): readonly SkillManifest[] => defaultSkillRegistry.listSkills(o);
export const searchSkills = (q: string, o?: SkillFilterOptions): readonly SkillManifest[] => defaultSkillRegistry.searchSkills(q, o);
export const getSkillsByCategory = (c: SkillCategory): readonly SkillManifest[] => defaultSkillRegistry.getSkillsByCategory(c);

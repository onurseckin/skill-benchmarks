import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type {
  SkillCategory,
  CanonicalSkillDomain,
  CanonicalSkill,
  SkillManifest,
  CatalogEntry,
  SkillFilterOptions,
  SkillPromptFormatOptions,
} from "./types";
import { CANONICAL_SKILLS } from "./canonical";
import { parseCatalogMarkdown, parseInstallsCount } from "./catalog-parser";
import { formatSkillPrompt, formatSkillsForAgentContext } from "./formatter";
import { parseSkillFile } from "./parser";
import { validateSkillManifest } from "./validator";
import {
  calculateSkillScore,
  collectSkillFilePaths,
  createCatalogEntry,
  normalizeSkillId,
  requireSubstantiveSkillManifest,
} from "./registry-support.js";

export { CANONICAL_SKILLS } from "./canonical";
export { parseCatalogMarkdown, parseInstallsCount } from "./catalog-parser";
export { formatSkillPrompt, formatSkillsForAgentContext } from "./formatter";

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
      const manifest: SkillManifest = {
        name: skill.name,
        version: skill.version !== undefined ? skill.version : "1.0.0",
        description: skill.description,
        category: skill.category,
        tags: skill.tags,
        author: skill.author.name,
        repository: skill.source,
        rules: skill.rules !== undefined ? skill.rules : [],
        tools: skill.tools !== undefined ? skill.tools : [],
        scripts: [],
        guidelines: skill.guidelines !== undefined ? skill.guidelines : [skill.description],
        dependencies: [],
      };
      this.skills.set(skill.id, manifest);
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
        manifest,
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
    const entry = createCatalogEntry(id, manifest, data, existing);
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

  requireSkill(id: string): SkillManifest {
    return requireSubstantiveSkillManifest(this.getSkill(id));
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

  size(): number { return this.skills.size; }
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

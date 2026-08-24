import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import type {
  SkillCategory,
  SkillManifest,
  CatalogEntry,
  SkillFilterOptions,
  SkillPromptFormatOptions,
  SkillRule,
  SkillSourceType,
} from "./types";
import { parseSkillFile } from "./parser";
import { validateSkillManifest } from "./validator";

function normalizeSkillId(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

export function parseInstallsCount(raw: string | number | undefined): number {
  if (raw === undefined) return 0;
  if (typeof raw === "number") return raw;
  const c = raw.trim().toUpperCase().replace(/,/g, "");
  if (c.endsWith("M")) {
    const n = Number.parseFloat(c.slice(0, -1));
    return Number.isNaN(n) ? 0 : Math.round(n * 1000000);
  }
  if (c.endsWith("K")) {
    const n = Number.parseFloat(c.slice(0, -1));
    return Number.isNaN(n) ? 0 : Math.round(n * 1000);
  }
  const num = Number.parseFloat(c);
  return Number.isNaN(num) ? 0 : Math.round(num);
}

const CATEGORY_MAP: readonly [string, SkillCategory][] = [["debug", "debugging"], ["bug", "debugging"], ["test", "testing"], ["qa", "testing"], ["security", "security"], ["compliance", "security"], ["doc", "documentation"], ["review", "code-review"], ["refactor", "refactoring"], ["devops", "devops"], ["cloud", "devops"], ["browser", "browser-automation"], ["database", "database"], ["sql", "database"], ["postgres", "database"], ["ai", "ai-ml"], ["ml", "ai-ml"], ["front", "frontend"], ["ui", "frontend"], ["back", "backend"], ["api", "backend"], ["workflow", "workflow"], ["git", "workflow"], ["scrap", "integrations"], ["mcp", "integrations"], ["integration", "integrations"], ["productiv", "productivity"], ["pdf", "productivity"], ["perf", "productivity"]];

function mapCategoryHeading(raw: string): SkillCategory {
  const n = raw.trim().toLowerCase();
  for (const [kw, cat] of CATEGORY_MAP) {
    if (n.includes(kw)) return cat;
  }
  return "general";
}

export function parseCatalogMarkdown(content: string): readonly CatalogEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: CatalogEntry[] = [];
  let currentCat: SkillCategory = "general";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      currentCat = mapCategoryHeading(trimmed.slice(3));
      continue;
    }
    if (!trimmed.startsWith("|") || trimmed.includes("---|---") || trimmed.includes("# | Skill") || trimmed.includes("Category | Count")) continue;
    const cols = trimmed.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
    if (cols.length < 3) continue;
    let skillName = "";
    let source = "";
    let installsDisplay = "";
    let rowCategory = currentCat;
    const [c0, c1, c2, c3] = cols;
    if (c0 !== undefined && c1 !== undefined && c2 !== undefined && c3 !== undefined) {
      if (!Number.isNaN(Number(c0))) {
        skillName = c1.replace(/`/g, "").trim();
        source = c2.trim();
        installsDisplay = c3.trim();
      } else {
        rowCategory = mapCategoryHeading(c0);
        skillName = c1.replace(/`/g, "").trim();
        source = c2.trim();
        installsDisplay = c3.trim();
      }
    } else if (c0 !== undefined && c1 !== undefined && c2 !== undefined) {
      skillName = c0.replace(/`/g, "").trim();
      source = c1.trim();
      installsDisplay = c2.trim();
    }
    if (skillName.length === 0 || source.length === 0) continue;
    entries.push({
      id: normalizeSkillId(skillName),
      name: skillName,
      category: rowCategory,
      source,
      sourceType: source.includes("/") ? "git" : "local",
      installs: parseInstallsCount(installsDisplay),
      installsDisplay: installsDisplay.length > 0 ? installsDisplay : undefined,
      description: `Skill ${skillName} from ${source}`,
      status: "available",
    });
  }
  return entries;
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
      if (e.isDirectory()) result.push(...await collectSkillFilePaths(full));
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

function formatRulesSection(prefix: string, title: string, rules: readonly SkillRule[], limit: number, withEx: boolean): string[] {
  if (rules.length === 0 || limit <= 0) return [];
  const lines: string[] = ["", `${prefix} ${title}`];
  for (let i = 0; i < Math.min(rules.length, limit); i++) {
    const r = rules[i];
    if (r !== undefined) {
      lines.push(`- **${r.title}**: ${r.description}`);
      if (withEx && r.examples !== undefined && r.examples.length > 0) {
        for (const ex of r.examples) lines.push(`  - Example: \`${ex}\``);
      }
    }
  }
  return lines;
}

export class SkillRegistry {
  private readonly skills: Map<string, SkillManifest> = new Map();
  private readonly catalog: Map<string, CatalogEntry> = new Map();
  private readonly categoryIndex: Map<string, Set<string>> = new Map();
  private readonly tagIndex: Map<string, Set<string>> = new Map();

  private index(map: Map<string, Set<string>>, key: string, id: string): void {
    const k = key.toLowerCase();
    const existing = map.get(k);
    const set = existing !== undefined ? existing : new Set<string>();
    set.add(id);
    map.set(k, set);
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
    const entry: CatalogEntry = { id, name: manifest.name, category: manifest.category, source: resolvedSource, sourceType: resolvedType, description: manifest.description, version: manifest.version, tags: manifest.tags, manifest, status: "valid", installs: resolvedInstalls, installsDisplay: resolvedDisplay, updatedAt: new Date().toISOString() };
    this.catalog.set(id, entry);
    return entry;
  }

  registerCatalogEntry(entry: CatalogEntry): void {
    const id = normalizeSkillId(entry.id.length > 0 ? entry.id : entry.name);
    this.catalog.set(id, entry);
    if (entry.manifest !== undefined) this.skills.set(id, entry.manifest);
    this.index(this.categoryIndex, entry.category, id);
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
    return this.getSkill(id) !== undefined;
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

  formatSkillPrompt(manifestOrId: SkillManifest | string, options?: SkillPromptFormatOptions): string {
    return formatSkillPrompt(manifestOrId, options, this);
  }

  formatSkillsForAgentContext(manifestsOrIds: ReadonlyArray<SkillManifest | string>, options?: SkillPromptFormatOptions): string {
    return formatSkillsForAgentContext(manifestsOrIds, options, this);
  }

  clear(): void {
    this.skills.clear();
    this.catalog.clear();
    this.categoryIndex.clear();
    this.tagIndex.clear();
  }

  size(): number {
    return this.skills.size;
  }
}

export const defaultSkillRegistry = new SkillRegistry();
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

export function formatSkillPrompt(
  manifestOrId: SkillManifest | string,
  options?: SkillPromptFormatOptions,
  registry?: SkillRegistry
): string {
  const m = typeof manifestOrId === "string" ? (registry !== undefined ? registry.getSkill(manifestOrId) : defaultSkillRegistry.getSkill(manifestOrId)) : manifestOrId;
  if (m === undefined) return `### Skill: ${manifestOrId}\n\nSkill definition not found in registry.\n`;

  const prefix = options !== undefined && options.headerPrefix !== undefined ? options.headerPrefix : "###";
  const subPrefix = `${prefix}#`;
  const withRules = options === undefined || options.includeRules === undefined ? true : options.includeRules;
  const withTools = options === undefined || options.includeTools === undefined ? true : options.includeTools;
  const withGuides = options === undefined || options.includeGuidelines === undefined ? true : options.includeGuidelines;
  const withEx = options === undefined || options.includeExamples === undefined ? true : options.includeExamples;
  const maxR = options !== undefined && options.maxRules !== undefined ? options.maxRules : Number.MAX_SAFE_INTEGER;

  const lines: string[] = [`${prefix} Skill: ${m.name} (v${m.version})`];
  if (m.description.length > 0) lines.push(m.description);

  const meta: string[] = [];
  if (m.category.length > 0) meta.push(`Category: ${m.category}`);
  if (m.tags.length > 0) meta.push(`Tags: ${m.tags.join(", ")}`);
  if (meta.length > 0) lines.push(meta.join(" | "));

  if (withRules && m.rules.length > 0) {
    const critical = m.rules.filter((r) => r.severity === "critical");
    const nonCritical = m.rules.filter((r) => r.severity !== "critical");
    lines.push(...formatRulesSection(subPrefix, "Critical Invariants (Must Follow):", critical, maxR, withEx));
    const rem = Math.max(0, maxR - critical.length);
    lines.push(...formatRulesSection(subPrefix, "Rules & Guidelines:", nonCritical, rem, withEx));
  }

  if (withGuides && m.guidelines.length > 0 && m.rules.length === 0) {
    lines.push("", `${subPrefix} Guidelines:`, ...m.guidelines.map((g) => `- ${g}`));
  }

  if (withTools && m.tools.length > 0) {
    lines.push("", `${subPrefix} Available Tools:`);
    for (const tool of m.tools) {
      lines.push(`- \`${tool.name}\`: ${tool.description}`);
      if (tool.command !== undefined && tool.command.length > 0) lines.push(`  - Command: \`${tool.command}\``);
    }
  }

  if (m.promptTemplate !== undefined && m.promptTemplate.length > 0) {
    lines.push("", `${subPrefix} Instructions:`, m.promptTemplate);
  }

  return lines.join("\n");
}

export function formatSkillsForAgentContext(
  manifestsOrIds: ReadonlyArray<SkillManifest | string>,
  options?: SkillPromptFormatOptions,
  registry?: SkillRegistry
): string {
  if (manifestsOrIds.length === 0) return "";
  const headerPrefix = options !== undefined && options.headerPrefix !== undefined ? options.headerPrefix : "##";
  const nestedOptions: SkillPromptFormatOptions = { ...options, headerPrefix: `${headerPrefix}#` };
  const formatted = manifestsOrIds.map((item) => formatSkillPrompt(item, nestedOptions, registry)).filter((s) => s.length > 0);
  if (formatted.length === 0) return "";
  return [`${headerPrefix} Active Agent Skills & Knowledge`, "The following skills and guidelines are active in this workspace:", "", formatted.join("\n\n---\n\n")].join("\n");
}

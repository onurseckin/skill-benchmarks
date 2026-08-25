import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogEntry, CanonicalSkillDomain, SkillCategory } from "./types";

export function normalizeSkillId(id: string): string {
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

export function parseAuthorFromSource(source: string): { readonly name: string; readonly handle: string; readonly repository: string } {
  const parts = source.split("/");
  if (parts.length >= 2) {
    const handle = parts[0] ?? "unknown";
    return { name: handle, handle, repository: source };
  }
  return { name: source, handle: source, repository: source };
}

const CATEGORY_MAP: readonly [string, SkillCategory][] = [
  ["debug", "debugging"],
  ["bug", "debugging"],
  ["test", "testing"],
  ["qa", "testing"],
  ["security", "security"],
  ["compliance", "security"],
  ["doc", "documentation"],
  ["review", "code-review"],
  ["refactor", "refactoring"],
  ["devops", "devops"],
  ["cloud", "devops"],
  ["browser", "browser-automation"],
  ["database", "database"],
  ["sql", "database"],
  ["postgres", "database"],
  ["ai", "ai-ml"],
  ["ml", "ai-ml"],
  ["front", "frontend"],
  ["ui", "frontend"],
  ["back", "backend"],
  ["api", "backend"],
  ["workflow", "workflow"],
  ["git", "workflow"],
  ["scrap", "integrations"],
  ["mcp", "integrations"],
  ["integration", "integrations"],
  ["productiv", "productivity"],
  ["pdf", "productivity"],
  ["perf", "productivity"],
];

export function mapCategoryHeading(raw: string): SkillCategory {
  const n = raw.trim().toLowerCase();
  for (const [kw, cat] of CATEGORY_MAP) {
    if (n.includes(kw)) return cat;
  }
  return "general";
}

export function mapDomainFromHeading(raw: string): CanonicalSkillDomain {
  const n = raw.trim().toLowerCase();
  if (n.includes("debug") || n.includes("bug")) return "debugging";
  if (n.includes("test") || n.includes("qa")) return "testing";
  if (n.includes("security")) return "security";
  if (n.includes("doc")) return "documentation";
  if (n.includes("review")) return "code-review";
  if (n.includes("overall")) return "overall";
  if (n.includes("devops") || n.includes("cloud")) return "devops";
  if (n.includes("browser")) return "browser-automation";
  if (n.includes("database")) return "database";
  if (n.includes("git")) return "workflow";
  if (n.includes("refactor")) return "refactoring";
  return "general";
}

export function parseCatalogMarkdown(content: string): readonly CatalogEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: CatalogEntry[] = [];
  let currentCat: SkillCategory = "general";
  let currentDomain: CanonicalSkillDomain = "general";
  let inCompositionSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      const heading = trimmed.slice(3).trim();
      if (heading.toLowerCase().includes("catalog composition")) {
        inCompositionSection = true;
        continue;
      }
      inCompositionSection = false;
      currentCat = mapCategoryHeading(heading);
      currentDomain = mapDomainFromHeading(heading);
      continue;
    }
    if (inCompositionSection) continue;
    if (!trimmed.startsWith("|") || trimmed.includes("---|---")) continue;
    const cols = trimmed.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
    if (cols.length < 3) continue;

    const [c0, c1, c2, c3] = cols;
    if (c0 === undefined || c1 === undefined || c2 === undefined) continue;
    if (c0.toLowerCase() === "category" || c0.toLowerCase() === "#" || c0.toLowerCase() === "skill") continue;
    if (c1.toLowerCase() === "skill" || c2.toLowerCase() === "source") continue;

    let skillName = "";
    let source = "";
    let installsDisplay = "";
    let rowCategory = currentCat;
    let rowDomain = currentDomain;

    if (c3 !== undefined) {
      if (!Number.isNaN(Number(c0))) {
        skillName = c1.replace(/`/g, "").trim();
        source = c2.trim();
        installsDisplay = c3.trim();
      } else {
        rowCategory = mapCategoryHeading(c0);
        rowDomain = mapDomainFromHeading(c0);
        skillName = c1.replace(/`/g, "").trim();
        source = c2.trim();
        installsDisplay = c3.trim();
      }
    } else {
      skillName = c0.replace(/`/g, "").trim();
      source = c1.trim();
      installsDisplay = c2.trim();
    }

    if (skillName.length === 0 || source.length === 0 || skillName.toLowerCase() === "skill") continue;
    if (source.includes(",") && !source.includes("/")) continue;

    const id = normalizeSkillId(skillName);
    const author = parseAuthorFromSource(source);
    entries.push({
      id,
      name: skillName,
      category: rowCategory,
      domain: rowDomain,
      source,
      sourceType: source.includes("/") ? "git" : "local",
      author,
      installs: parseInstallsCount(installsDisplay),
      installsDisplay: installsDisplay.length > 0 ? installsDisplay : undefined,
      description: `Skill ${skillName} from ${source}`,
      status: "available",
    });
  }
  return entries;
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

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  parseCatalogMarkdown,
  sanitizeSkillId,
  SkillDownloader,
  SkillRegistry,
} from "../skills/index";
import type { CatalogEntry, SkillSyncError } from "../skills/index";

interface SyncCliOptions {
  readonly category?: string;
  readonly skill?: string;
  readonly limit?: number;
  readonly dest: string;
  readonly catalog: string;
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly help: boolean;
}

interface SummaryReportData {
  readonly totalCatalogSkills: number;
  readonly matchedSkills: number;
  readonly downloadedCount: number;
  readonly cachedCount: number;
  readonly failedCount: number;
  readonly durationMs: number;
  readonly catalogJsonPath: string;
  readonly categoryStats: Record<string, number>;
  readonly errors: readonly SkillSyncError[];
}

interface CatalogIndex {
  readonly version: string;
  readonly generatedAt: string;
  readonly catalogSource: string;
  readonly targetDirectory: string;
  readonly statistics: {
    readonly totalCatalogSkills: number;
    readonly matchedSkills: number;
    readonly downloadedCount: number;
    readonly cachedCount: number;
    readonly failedCount: number;
    readonly durationMs: number;
  };
  readonly categories: Record<string, number>;
  readonly entries: readonly CatalogEntry[];
}

function parseCliArgs(args: readonly string[]): SyncCliOptions {
  let category: string | undefined = undefined;
  let skill: string | undefined = undefined;
  let limit: number | undefined = undefined;
  let dest = ".skills";
  let catalog = "skill-list/skill-list.md";
  let force = false;
  let dryRun = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;

    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--force" || arg === "-f") {
      force = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--category" || arg === "-c") {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        category = next;
        i++;
      }
    } else if (arg.startsWith("--category=")) {
      category = arg.slice("--category=".length);
    } else if (arg === "--skill" || arg === "-s") {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        skill = next;
        i++;
      }
    } else if (arg.startsWith("--skill=")) {
      skill = arg.slice("--skill=".length);
    } else if (arg === "--limit" || arg === "-l") {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        const parsed = Number.parseInt(next, 10);
        if (!Number.isNaN(parsed) && parsed > 0) limit = parsed;
        i++;
      }
    } else if (arg.startsWith("--limit=")) {
      const parsed = Number.parseInt(arg.slice("--limit=".length), 10);
      if (!Number.isNaN(parsed) && parsed > 0) limit = parsed;
    } else if (arg === "--dest" || arg === "-d") {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        dest = next;
        i++;
      }
    } else if (arg.startsWith("--dest=")) {
      dest = arg.slice("--dest=".length);
    } else if (arg === "--catalog") {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        catalog = next;
        i++;
      }
    } else if (arg.startsWith("--catalog=")) {
      catalog = arg.slice("--catalog=".length);
    }
  }

  return { category, skill, limit, dest, catalog, force, dryRun, help };
}

function printHelp(): void {
  process.stdout.write(`
Skills Catalog Synchronization CLI

Usage:
  bun run sync:skills [options]
  bun run src/scripts/sync-skills.ts [options]

Options:
  --category, -c <name>   Filter skills by category (e.g. debugging, security)
  --skill, -s <name>      Filter skills by name or ID (e.g. find-skills, tdd)
  --limit, -l <num>       Maximum number of skills to synchronize
  --dest, -d <dir>        Destination directory for cached skills and catalog (default: .skills)
  --catalog <path>        Path to markdown catalog file (default: skill-list/skill-list.md)
  --force, -f             Force re-download even if skills are cached
  --dry-run               Simulate catalog ingestion without downloading or writing files
  --help, -h              Display this help message

Examples:
  bun run sync:skills --dry-run
  bun run sync:skills --category debugging --limit 3
  bun run sync:skills --skill tdd --force
  bun run sync:skills --dest .skills
`);
}

function isValidCatalogEntry(entry: CatalogEntry): boolean {
  const n = entry.name.toLowerCase();
  const s = entry.source.toLowerCase();
  if (n === "skill" || s === "source") return false;
  if (entry.installsDisplay !== undefined && entry.installsDisplay.includes("%")) return false;
  if (entry.source.includes(",") && !entry.source.includes("/")) return false;
  return entry.name.length > 0 && entry.source.length > 0;
}

function filterEntries(
  entries: readonly CatalogEntry[],
  categoryFilter?: string,
  skillFilter?: string,
  limit?: number
): readonly CatalogEntry[] {
  let filtered = entries.filter(isValidCatalogEntry).filter((entry) => {
    if (categoryFilter !== undefined) {
      if (!entry.category.toLowerCase().includes(categoryFilter.toLowerCase())) return false;
    }
    if (skillFilter !== undefined) {
      const q = skillFilter.toLowerCase();
      if (!entry.name.toLowerCase().includes(q) && !entry.id.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  if (limit !== undefined && limit > 0) {
    filtered = filtered.slice(0, limit);
  }

  return filtered;
}

function computeCategoryStats(entries: readonly CatalogEntry[]): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const entry of entries) {
    const current = stats[entry.category];
    stats[entry.category] = current !== undefined ? current + 1 : 1;
  }
  return stats;
}

function printSummaryReport(data: SummaryReportData): void {
  process.stdout.write("\n========================================\n");
  process.stdout.write("      Skills Catalog Sync Summary       \n");
  process.stdout.write("========================================\n");
  process.stdout.write(`Total in Catalog:     ${data.totalCatalogSkills}\n`);
  process.stdout.write(`Target Skills:        ${data.matchedSkills}\n`);
  process.stdout.write(`Newly Downloaded:     ${data.downloadedCount}\n`);
  process.stdout.write(`Cached (Fresh):       ${data.cachedCount}\n`);
  process.stdout.write(`Failed:               ${data.failedCount}\n`);
  process.stdout.write(`Duration:             ${data.durationMs}ms\n`);
  process.stdout.write(`Catalog Index:        ${data.catalogJsonPath}\n`);

  process.stdout.write("\nCategories Breakdown:\n");
  for (const [cat, count] of Object.entries(data.categoryStats)) {
    process.stdout.write(`  - ${cat}: ${count}\n`);
  }

  if (data.errors.length > 0) {
    process.stdout.write(`\nErrors (${data.errors.length}):\n`);
    for (const err of data.errors) {
      process.stdout.write(`  - ${err.skillId}: ${err.error}\n`);
    }
  }
  process.stdout.write("========================================\n\n");
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseCliArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const catalogPath = resolve(process.cwd(), options.catalog);
  const destDir = resolve(process.cwd(), options.dest);

  let rawContent: string;
  try {
    rawContent = await readFile(catalogPath, "utf-8");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Failed to read catalog file at "${catalogPath}": ${msg}\n`);
    process.exit(1);
  }

  const rawEntries = parseCatalogMarkdown(rawContent);
  const validEntries = rawEntries.filter(isValidCatalogEntry);
  if (validEntries.length === 0) {
    process.stderr.write(`No skill entries found in catalog file at "${catalogPath}".\n`);
    process.exit(1);
  }

  const targetEntries = filterEntries(
    validEntries,
    options.category,
    options.skill,
    options.limit
  );

  if (targetEntries.length === 0) {
    process.stdout.write("No skills matched the specified filters.\n");
    process.exit(0);
  }

  if (options.dryRun) {
    process.stdout.write("\n=== Skills Catalog Sync (Dry Run) ===\n\n");
    process.stdout.write(`Catalog Source: ${catalogPath}\n`);
    process.stdout.write(`Target Directory: ${destDir}\n`);
    process.stdout.write(`Total Catalog Skills: ${validEntries.length}\n`);
    process.stdout.write(`Skills Matched Filters: ${targetEntries.length}\n\n`);

    process.stdout.write("Matched Skills to Sync:\n");
    for (const entry of targetEntries) {
      const installsStr = entry.installsDisplay !== undefined ? entry.installsDisplay : String(entry.installs);
      process.stdout.write(`- [${entry.category}] ${entry.name} (${entry.source}) - Installs: ${installsStr}\n`);
    }
    process.stdout.write("\nDry run completed. No files were downloaded or modified.\n\n");
    process.exit(0);
  }

  const startTime = Date.now();
  const downloader = new SkillDownloader(destDir, { force: options.force });
  const registry = new SkillRegistry();

  for (const entry of validEntries) {
    registry.registerCatalogEntry(entry);
  }

  await mkdir(destDir, { recursive: true });

  let downloadedCount = 0;
  let cachedCount = 0;
  let failedCount = 0;
  const errors: SkillSyncError[] = [];
  const processedEntries: CatalogEntry[] = [];

  process.stdout.write(`\n=== Synchronizing ${targetEntries.length} Skill(s) ===\n\n`);

  for (const entry of targetEntries) {
    const sourceSanitized = sanitizeSkillId(entry.source);
    const targetDir = join(destDir, sourceSanitized);

    try {
      const result = await downloader.download(entry.source, {
        force: options.force,
        targetDir,
      });

      const registered = registry.registerSkill(result.manifest, {
        id: entry.id,
        name: entry.name,
        category: entry.category,
        source: entry.source,
        sourceType: entry.sourceType,
        installs: entry.installs,
        installsDisplay: entry.installsDisplay,
        description: entry.description,
        cachedPath: result.targetDir,
        manifestPath: join(result.targetDir, "SKILL.md"),
        manifest: result.manifest,
        status: "downloaded",
        updatedAt: new Date().toISOString(),
      });

      processedEntries.push(registered);

      if (result.cached) {
        cachedCount++;
        process.stdout.write(`  ✓ [cached]     ${entry.name} (${entry.category})\n`);
      } else {
        downloadedCount++;
        process.stdout.write(`  ✓ [downloaded] ${entry.name} (${entry.category})\n`);
      }
    } catch (err) {
      failedCount++;
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ skillId: entry.id, error: message });

      const failedEntry: CatalogEntry = {
        id: entry.id,
        name: entry.name,
        category: entry.category,
        source: entry.source,
        sourceType: entry.sourceType,
        installs: entry.installs,
        installsDisplay: entry.installsDisplay,
        description: entry.description,
        status: "failed",
        updatedAt: new Date().toISOString(),
      };
      registry.registerCatalogEntry(failedEntry);
      processedEntries.push(failedEntry);

      process.stdout.write(`  ✗ [failed]     ${entry.name} (${entry.category}): ${message}\n`);
    }
  }

  const durationMs = Date.now() - startTime;
  const allCatalogEntries = registry.getCatalogEntries();
  const categoryStats = computeCategoryStats(allCatalogEntries);

  const catalogIndex: CatalogIndex = {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    catalogSource: catalogPath,
    targetDirectory: destDir,
    statistics: {
      totalCatalogSkills: allCatalogEntries.length,
      matchedSkills: targetEntries.length,
      downloadedCount,
      cachedCount,
      failedCount,
      durationMs,
    },
    categories: categoryStats,
    entries: allCatalogEntries,
  };

  const catalogJsonPath = join(destDir, "catalog.json");
  await writeFile(catalogJsonPath, JSON.stringify(catalogIndex, null, 2), "utf-8");

  printSummaryReport({
    totalCatalogSkills: allCatalogEntries.length,
    matchedSkills: targetEntries.length,
    downloadedCount,
    cachedCount,
    failedCount,
    durationMs,
    catalogJsonPath,
    categoryStats,
    errors,
  });

  if (failedCount > 0 && downloadedCount === 0 && cachedCount === 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  process.stderr.write(`Unexpected error during catalog sync: ${String(err)}\n`);
  process.exit(1);
});

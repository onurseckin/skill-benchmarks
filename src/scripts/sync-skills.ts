import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  parseCatalogMarkdown,
  sanitizeSkillId,
  SkillDownloader,
  SkillRegistry,
} from "../skills/index.js";
import type { CatalogEntry, SkillSyncError } from "../skills/index.js";
import {
  getSyncSkillsHelp,
  parseSyncSkillsOptions,
  SyncSkillsInputError,
} from "./sync-skills-options.js";

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
  const options = parseSyncSkillsOptions(args);

  if (options.help) {
    process.stdout.write(`${getSyncSkillsHelp()}\n`);
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
  if (err instanceof SyncSkillsInputError) {
    process.stderr.write(`sync-skills: ${err.code}: Sync options are invalid.\n`);
    process.exit(2);
  }
  process.stderr.write("sync-skills: command_failed: Synchronization could not be completed.\n");
  process.exit(1);
});

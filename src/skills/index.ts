import scenarioCatalogRaw from "../../scenarios/catalog.json";
import type { CanonicalSkill, SkillLookupQuery } from "./types";
import { getCanonicalSkill, getCanonicalSkills } from "./registry";

export const SCENARIO_CATALOG_CANONICAL_COUNT: number = scenarioCatalogRaw.canonicalSkills.length;

export function lookupCanonicalSkill(query: SkillLookupQuery): readonly CanonicalSkill[] {
  let results = getCanonicalSkills();
  if (query.id !== undefined) {
    const s = getCanonicalSkill(query.id);
    return s !== undefined ? [s] : [];
  }
  if (query.domain !== undefined) {
    results = results.filter((s) => s.domain.toLowerCase() === query.domain?.toLowerCase());
  }
  if (query.category !== undefined) {
    results = results.filter((s) => s.category.toLowerCase() === query.category?.toLowerCase());
  }
  if (query.minInstalls !== undefined) {
    results = results.filter((s) => s.installs.rawInstalls >= (query.minInstalls ?? 0));
  }
  if (query.author !== undefined) {
    const a = query.author.toLowerCase();
    results = results.filter(
      (s) => s.author.handle.toLowerCase().includes(a) || s.author.name.toLowerCase().includes(a),
    );
  }
  if (query.query !== undefined && query.query.length > 0) {
    const q = query.query.toLowerCase();
    results = results.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }
  return results;
}

export type {
  SkillCategory,
  CanonicalSkillDomain,
  CanonicalSkill,
  SkillAuthor,
  SkillInstallStats,
  SkillCategoryMapping,
  CatalogComposition,
  SkillCatalogStats,
  SkillLookupQuery,
  SkillSourceType,
  RuleSeverity,
  SkillRule,
  SkillTool,
  SkillScript,
  SkillSourceLocation,
  SkillManifest,
  CatalogEntry,
  SkillDownloadOptions,
  SkillValidationResult,
  SkillSyncError,
  SkillSyncReport,
  MarkdownSection,
  SkillParseOptions,
  SkillFilterOptions,
  SkillPromptFormatOptions,
} from "./types";

export {
  parseFrontmatter,
  parseMarkdownSections,
  extractRulesFromMarkdown,
  extractToolsFromMarkdown,
  extractScriptsFromMarkdown,
  parseSkillContent,
  parseSkillFile,
} from "./parser";

export {
  SkillValidationError,
  validatePathSafety,
  validateSecurityInvariants,
  validateSkillManifest,
  assertValidSkill,
} from "./validator";

export type { SkillDownloadResult } from "./downloader";

export {
  sanitizeSkillId,
  computeSha256,
  isCacheFresh,
  fetchWithRetry,
  downloadFromGit,
  downloadFromHttp,
  stageAndVerifySkill,
  downloadSkill,
  SkillDownloader,
} from "./downloader";

export {
  CANONICAL_SKILLS,
  SkillRegistry,
  defaultSkillRegistry,
  getCanonicalSkill,
  getCanonicalSkills,
  getSkillsByDomain,
  searchCanonicalSkills,
  registerSkill,
  registerCatalogEntry,
  loadSkillsFromDirectory,
  loadSkillCatalog,
  saveSkillCatalog,
  getCatalogEntries,
  getSkill,
  hasSkill,
  listSkills,
  searchSkills,
  getSkillsByCategory,
  formatSkillPrompt,
  formatSkillsForAgentContext,
  parseInstallsCount,
  parseCatalogMarkdown,
} from "./registry";

export type SkillCategory =
  | "devops"
  | "workflow"
  | "frontend"
  | "integrations"
  | "security"
  | "backend"
  | "productivity"
  | "documentation"
  | "testing"
  | "creative"
  | "database"
  | "product-management"
  | "research"
  | "data-science"
  | "ai-ml"
  | "debugging"
  | "code-review"
  | "refactoring"
  | "browser-automation"
  | "general"
  | (string & {});

export type CanonicalSkillDomain =
  | "overall"
  | "debugging"
  | "testing"
  | "security"
  | "documentation"
  | "code-review"
  | "devops"
  | "browser-automation"
  | "database"
  | "workflow"
  | "integrations"
  | "productivity"
  | "refactoring"
  | "api-design"
  | "general"
  | (string & {});

export type SkillSourceType = "git" | "github-raw" | "local" | "tarball";

export type RuleSeverity = "critical" | "warning" | "info" | "guideline";

export interface SkillRule {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly severity?: RuleSeverity;
  readonly category?: string;
  readonly pattern?: string;
  readonly examples?: ReadonlyArray<string>;
}

export interface SkillTool {
  readonly name: string;
  readonly description: string;
  readonly command?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly schema?: Readonly<Record<string, unknown>>;
  readonly env?: Readonly<Record<string, string>>;
}

export interface SkillScript {
  readonly name: string;
  readonly path: string;
  readonly runtime?: string;
  readonly content?: string;
  readonly entrypoint?: string;
  readonly args?: ReadonlyArray<string>;
  readonly isExecutable?: boolean;
}

export interface SkillSourceLocation {
  readonly type: SkillSourceType;
  readonly uri: string;
  readonly branch?: string;
  readonly commit?: string;
  readonly path?: string;
  readonly subpath?: string;
}

export interface SkillManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly category: SkillCategory;
  readonly tags: ReadonlyArray<string>;
  readonly author?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly rules: ReadonlyArray<SkillRule>;
  readonly tools: ReadonlyArray<SkillTool>;
  readonly scripts: ReadonlyArray<SkillScript>;
  readonly guidelines: ReadonlyArray<string>;
  readonly promptTemplate?: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly source?: SkillSourceLocation;
  readonly rawContent?: string;
  readonly frontmatter?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SkillAuthor {
  readonly name: string;
  readonly handle: string;
  readonly repository: string;
  readonly url?: string;
  readonly organization?: string;
}

export interface SkillInstallStats {
  readonly rawInstalls: number;
  readonly display: string;
  readonly rank?: number;
  readonly categoryRank?: number;
  readonly sharePercentage?: number;
  readonly telemetrySnapshotDate?: string;
}

export interface SkillCategoryMapping {
  readonly domain: CanonicalSkillDomain;
  readonly category: SkillCategory;
  readonly keywords: ReadonlyArray<string>;
  readonly description?: string;
}

export interface CatalogComposition {
  readonly category: SkillCategory;
  readonly count: number;
  readonly sharePercentage: number;
}

export interface CanonicalSkill {
  readonly id: string;
  readonly name: string;
  readonly domain: CanonicalSkillDomain;
  readonly category: SkillCategory;
  readonly source: string;
  readonly sourceType: SkillSourceType;
  readonly author: SkillAuthor;
  readonly installs: SkillInstallStats;
  readonly description: string;
  readonly tags: ReadonlyArray<string>;
  readonly rules?: ReadonlyArray<SkillRule>;
  readonly guidelines?: ReadonlyArray<string>;
  readonly tools?: ReadonlyArray<SkillTool>;
  readonly version?: string;
  readonly status: "available" | "downloaded" | "failed" | "valid" | "invalid";
  readonly verified?: boolean;
  readonly updatedAt?: string;
}

export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly category: SkillCategory;
  readonly source: string;
  readonly sourceType: SkillSourceType;
  readonly url?: string;
  readonly installs?: number;
  readonly installsDisplay?: string;
  readonly description: string;
  readonly version?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly cachedPath?: string;
  readonly manifestPath?: string;
  readonly manifest?: SkillManifest;
  readonly status: "available" | "downloaded" | "failed" | "valid" | "invalid";
  readonly updatedAt?: string;
  readonly domain?: CanonicalSkillDomain;
  readonly author?: SkillAuthor;
}

export interface SkillCatalogStats {
  readonly totalSkills: number;
  readonly totalInstalls: number;
  readonly domainCounts: Readonly<Record<string, number>>;
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly topSkills: ReadonlyArray<CanonicalSkill>;
}

export interface SkillLookupQuery {
  readonly id?: string;
  readonly name?: string;
  readonly category?: SkillCategory;
  readonly domain?: CanonicalSkillDomain;
  readonly minInstalls?: number;
  readonly author?: string;
  readonly query?: string;
  readonly tags?: ReadonlyArray<string>;
}

export interface SkillDownloadOptions {
  readonly targetDir?: string;
  readonly force?: boolean;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly backoffFactor?: number;
  readonly initialDelayMs?: number;
  readonly sourceType?: SkillSourceType;
  readonly token?: string;
  readonly branch?: string;
  readonly shallow?: boolean;
}

export interface SkillValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly checkedRulesCount: number;
  readonly securityPass: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface SkillSyncError {
  readonly skillId: string;
  readonly error: string;
}

export interface SkillSyncReport {
  readonly totalSkills: number;
  readonly downloadedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly durationMs: number;
  readonly timestamp: string;
  readonly errors: ReadonlyArray<SkillSyncError>;
  readonly entries: ReadonlyArray<CatalogEntry>;
}

export interface MarkdownSection {
  readonly heading: string;
  readonly level: number;
  readonly content: string;
  readonly subSections?: ReadonlyArray<MarkdownSection>;
}

export interface SkillParseOptions {
  readonly sourcePath?: string;
  readonly defaultCategory?: SkillCategory;
  readonly sanitize?: boolean;
  readonly inferRulesFromHeadings?: boolean;
}

export interface SkillFilterOptions {
  readonly category?: SkillCategory;
  readonly domain?: CanonicalSkillDomain;
  readonly tags?: ReadonlyArray<string>;
  readonly minInstalls?: number;
  readonly minRules?: number;
  readonly hasTools?: boolean;
  readonly searchQuery?: string;
  readonly status?: string;
  readonly author?: string;
}

export interface SkillPromptFormatOptions {
  readonly includeRules?: boolean;
  readonly includeTools?: boolean;
  readonly includeGuidelines?: boolean;
  readonly includeExamples?: boolean;
  readonly maxRules?: number;
  readonly headerPrefix?: string;
}

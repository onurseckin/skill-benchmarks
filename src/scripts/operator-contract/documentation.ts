import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { commandSpecifications } from "../../cli/grammar/specification.js";
import { requireCondition } from "./assertions.js";
import { repositoryRoot } from "./fixture.js";

const architectureRelativePaths = [
  "README.md",
  "00-reading-the-book.md",
  "01-boundaries-and-admission/README.md",
  "01-boundaries-and-admission/catalog-and-admission.md",
  "01-boundaries-and-admission/cli-control-plane.md",
  "01-boundaries-and-admission/execution-modes.md",
  "02-execution-and-artifacts/README.md",
  "02-execution-and-artifacts/matrix-sweeps.md",
  "02-execution-and-artifacts/runner-and-tools.md",
  "02-execution-and-artifacts/workspaces-and-artifacts.md",
  "03-isolation-and-lifecycle/README.md",
  "03-isolation-and-lifecycle/container-pool.md",
  "03-isolation-and-lifecycle/telemetry.md",
  "04-provider-boundary/README.md",
  "04-provider-boundary/adapter-contract.md",
  "04-provider-boundary/live-readiness.md",
  "05-evidence-and-evaluation/README.md",
  "05-evidence-and-evaluation/deterministic-evaluation.md",
  "05-evidence-and-evaluation/evidence-authority.md",
  "06-persistence-and-readers/README.md",
  "06-persistence-and-readers/reports-replay-and-server.md",
  "06-persistence-and-readers/sqlite-and-run-records.md",
  "07-diagnostics-and-internal-surfaces/README.md",
  "07-diagnostics-and-internal-surfaces/arena-and-tournament.md",
  "07-diagnostics-and-internal-surfaces/chaos.md",
  "07-diagnostics-and-internal-surfaces/streaming-and-tunnels.md",
  "08-operations-and-testbed/README.md",
  "08-operations-and-testbed/testbed-delivery.md",
  "08-operations-and-testbed/verification-boundary.md",
  "appendices/README.md",
  "appendices/current-limitations.md",
  "appendices/source-map.md",
  "appendices/terminology.md",
] as const;

const partDirectories = [
  "01-boundaries-and-admission",
  "02-execution-and-artifacts",
  "03-isolation-and-lifecycle",
  "04-provider-boundary",
  "05-evidence-and-evaluation",
  "06-persistence-and-readers",
  "07-diagnostics-and-internal-surfaces",
  "08-operations-and-testbed",
] as const;

const archiveDirectories = [
  join(repositoryRoot, "docs", "archive", "architecture", "2026-08-pre-reliability"),
  join(repositoryRoot, "docs", "archive", "blueprints", "2026-08-pre-reliability"),
] as const;

export function verifyDocumentationContract(): void {
  const architectureDirectory = join(repositoryRoot, "docs", "architecture");
  const documentationFiles = [
    join(repositoryRoot, "README.md"),
    ...collectMarkdown(join(repositoryRoot, "docs", "usage-guide")),
    ...collectMarkdown(architectureDirectory),
  ];
  for (const file of documentationFiles) verifyLinks(file);
  verifyArchitectureBook(architectureDirectory);
  verifyArchives();
  verifyCommandReference();
}

function verifyCommandReference(): void {
  const commandReference = readFileSync(
    join(repositoryRoot, "docs", "usage-guide", "cli-reference", "commands.md"),
    "utf8",
  );
  for (const specification of commandSpecifications) {
    requireCondition(
      commandReference.includes(`\`${specification.name}\``),
      `docs_command_missing:${specification.name}`,
    );
    for (const flag of specification.flags) {
      requireCondition(
        commandReference.includes(`--${flag.name}`),
        `docs_flag_missing:${flag.name}`,
      );
    }
  }
  requireCondition(commandReference.includes("bun run cli --"), "docs_entrypoint_missing");
  requireCondition(!commandReference.includes("bun run src/cli"), "docs_source_entrypoint_present");
}

function collectMarkdown(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectMarkdown(entryPath));
    else if (entry.isFile() && extname(entryPath) === ".md") files.push(entryPath);
  }
  return files;
}

function verifyLinks(file: string): void {
  const content = readFileSync(file, "utf8");
  requireCondition(!content.includes("file://"), `docs_file_uri_present:${file}`);
  requireCondition(!content.includes("/Users/"), `docs_absolute_workspace_path:${file}`);
  for (const target of markdownLinkTargets(content)) {
    if (/^(?:https?:|mailto:)/.test(target)) continue;
    const [pathPart, anchor] = target.split("#", 2);
    const targetFile =
      pathPart === "" ? file : resolve(dirname(file), decodeURIComponent(pathPart ?? ""));
    requireCondition(existsSync(targetFile), `docs_link_missing:${file}:${target}`);
    if (anchor !== undefined && anchor !== "") verifyAnchor(targetFile, anchor, file);
  }
}

function verifyArchitectureBook(architectureDirectory: string): void {
  const documentedPaths = collectMarkdown(architectureDirectory)
    .map((file) => relative(architectureDirectory, file))
    .sort();
  const expectedPaths = [...architectureRelativePaths].sort();
  requireCondition(
    documentedPaths.length === expectedPaths.length,
    "architecture_book_outline_count_mismatch",
  );
  for (const expectedPath of expectedPaths) {
    requireCondition(
      documentedPaths.includes(expectedPath),
      `architecture_book_outline_missing:${expectedPath}`,
    );
  }
  for (const relativePath of architectureRelativePaths) {
    verifyArchitecturePage(join(architectureDirectory, relativePath), architectureDirectory);
  }
  verifyBookNavigation(architectureDirectory);
  verifySourceMap(architectureDirectory);
}

function verifyArchitecturePage(file: string, architectureDirectory: string): void {
  const content = readFileSync(file, "utf8");
  const architectureRoot = join(architectureDirectory, "README.md");
  const relativePath = relative(architectureDirectory, file);
  requireCondition(content.startsWith("# "), `architecture_title_missing:${relativePath}`);
  requireCondition(content.includes("**Status:**"), `architecture_status_missing:${relativePath}`);
  requireCondition(
    content.includes("## Source anchors"),
    `architecture_source_anchors_missing:${relativePath}`,
  );
  requireCondition(
    content.includes("## Limitations"),
    `architecture_limitations_missing:${relativePath}`,
  );
  requireCondition(
    hasSourceAnchor(file, sectionContent(content, "## Source anchors")),
    `architecture_source_anchor_link_missing:${relativePath}`,
  );
  if (file === architectureRoot) {
    requireCondition(content.includes("## Status legend"), "architecture_status_legend_missing");
    requireCondition(content.includes("## Parts"), "architecture_parts_missing");
    return;
  }
  requireCondition(
    content.includes("[Book index]"),
    `architecture_book_navigation_missing:${relativePath}`,
  );
  requireCondition(
    hasResolvedLink(file, content, architectureRoot),
    `architecture_book_index_target_missing:${relativePath}`,
  );
  if (relativePath.startsWith("appendices/") && relativePath !== "appendices/README.md") {
    requireCondition(
      content.includes("[Appendix index]"),
      `architecture_appendix_navigation_missing:${relativePath}`,
    );
  }
  if (isPartChapter(relativePath)) {
    requireCondition(
      content.includes("[Part index]"),
      `architecture_part_navigation_missing:${relativePath}`,
    );
  }
}

function verifyBookNavigation(architectureDirectory: string): void {
  const bookRoot = join(architectureDirectory, "README.md");
  const readingGuide = join(architectureDirectory, "00-reading-the-book.md");
  const appendicesIndex = join(architectureDirectory, "appendices", "README.md");
  const bookContent = readFileSync(bookRoot, "utf8");
  requireCondition(
    hasResolvedLink(bookRoot, bookContent, readingGuide),
    "architecture_reading_guide_missing",
  );
  for (const partDirectory of partDirectories) {
    const partIndex = join(architectureDirectory, partDirectory, "README.md");
    requireCondition(
      hasResolvedLink(bookRoot, bookContent, partIndex),
      `architecture_part_missing:${partDirectory}`,
    );
    verifyPartIndex(partIndex, architectureDirectory, bookRoot);
  }
  requireCondition(
    hasResolvedLink(bookRoot, bookContent, appendicesIndex),
    "architecture_appendices_missing",
  );
  const readingContent = readFileSync(readingGuide, "utf8");
  requireCondition(
    hasResolvedLink(
      readingGuide,
      readingContent,
      join(architectureDirectory, partDirectories[0], "README.md"),
    ),
    "architecture_reading_first_part_missing",
  );
  requireCondition(
    hasResolvedLink(readingGuide, readingContent, appendicesIndex),
    "architecture_reading_appendices_missing",
  );
  const appendicesContent = readFileSync(appendicesIndex, "utf8");
  for (const appendixPath of architectureRelativePaths.filter(
    (relativePath) =>
      relativePath.startsWith("appendices/") && relativePath !== "appendices/README.md",
  )) {
    requireCondition(
      hasResolvedLink(
        appendicesIndex,
        appendicesContent,
        join(architectureDirectory, appendixPath),
      ),
      `architecture_appendix_missing:${appendixPath}`,
    );
  }
}

function verifyPartIndex(partIndex: string, architectureDirectory: string, bookRoot: string): void {
  const content = readFileSync(partIndex, "utf8");
  const partDirectory = dirname(partIndex);
  requireCondition(content.includes("## Chapters"), `architecture_chapters_missing:${partIndex}`);
  requireCondition(
    hasResolvedLink(partIndex, content, bookRoot),
    `architecture_part_book_index_missing:${partIndex}`,
  );
  for (const relativePath of architectureRelativePaths) {
    const chapter = join(architectureDirectory, relativePath);
    if (dirname(chapter) !== partDirectory || chapter === partIndex) continue;
    requireCondition(
      hasResolvedLink(partIndex, content, chapter),
      `architecture_part_chapter_missing:${relativePath}`,
    );
  }
}

function verifySourceMap(architectureDirectory: string): void {
  const sourceMap = join(architectureDirectory, "appendices", "source-map.md");
  const content = readFileSync(sourceMap, "utf8");
  const sourceDirectory = join(repositoryRoot, "src");
  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sourceRoot = entry.name;
    const row = content.split(/\r?\n/).find((line) => line.includes(`| \`${sourceRoot}\` `));
    requireCondition(row !== undefined, `architecture_source_map_missing:${sourceRoot}`);
    const columns =
      row
        ?.split("|")
        .slice(1, -1)
        .map((value) => value.trim()) ?? [];
    requireCondition(
      columns.length === 4 && columns.every((value) => value !== ""),
      `architecture_source_map_row_invalid:${sourceRoot}`,
    );
    requireCondition(
      markdownLinkTargets(row ?? "").some((target) =>
        resolvesInside(sourceMap, target, join(sourceDirectory, sourceRoot)),
      ),
      `architecture_source_map_anchor_missing:${sourceRoot}`,
    );
    requireCondition(
      markdownLinkTargets(row ?? "").some((target) =>
        resolvesInside(sourceMap, target, architectureDirectory),
      ),
      `architecture_source_map_behavior_missing:${sourceRoot}`,
    );
  }
}

function verifyArchives(): void {
  for (const archiveDirectory of archiveDirectories) {
    const archiveIndex = join(archiveDirectory, "README.md");
    requireCondition(existsSync(archiveIndex), `archive_index_missing:${archiveDirectory}`);
    const indexContent = readFileSync(archiveIndex, "utf8").toLowerCase();
    requireCondition(
      indexContent.includes("not a source of truth"),
      `archive_current_disclaimer_missing:${archiveDirectory}`,
    );
    for (const file of collectMarkdown(archiveDirectory)) {
      const content = readFileSync(file, "utf8");
      requireCondition(!content.includes("file://"), `archive_file_uri_present:${file}`);
      requireCondition(!content.includes("/Users/"), `archive_absolute_workspace_path:${file}`);
      verifyLinks(file);
    }
  }
}

function isPartChapter(relativePath: string): boolean {
  return partDirectories.some(
    (partDirectory) =>
      relativePath.startsWith(`${partDirectory}/`) && relativePath !== `${partDirectory}/README.md`,
  );
}

function sectionContent(content: string, heading: string): string {
  const start = content.indexOf(heading);
  if (start < 0) return "";
  const remaining = content.slice(start + heading.length);
  const nextHeading = remaining.search(/\n##\s+/);
  return nextHeading < 0 ? remaining : remaining.slice(0, nextHeading);
}

function hasSourceAnchor(file: string, content: string): boolean {
  return markdownLinkTargets(content).some((target) =>
    resolvesInside(file, target, join(repositoryRoot, "src")),
  );
}

function hasResolvedLink(file: string, content: string, targetFile: string): boolean {
  return markdownLinkTargets(content).some(
    (target) => resolveMarkdownTarget(file, target) === targetFile,
  );
}

function resolvesInside(file: string, target: string, directory: string): boolean {
  const targetFile = resolveMarkdownTarget(file, target);
  const sourceRelativePath = relative(directory, targetFile);
  return (
    sourceRelativePath !== "" &&
    !sourceRelativePath.startsWith("..") &&
    !isAbsolute(sourceRelativePath)
  );
}

function markdownLinkTargets(content: string): readonly string[] {
  return [...content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

function resolveMarkdownTarget(file: string, target: string): string {
  const [pathPart] = target.split("#", 2);
  return pathPart === "" ? file : resolve(dirname(file), decodeURIComponent(pathPart ?? ""));
}

function verifyAnchor(targetFile: string, anchor: string, sourceFile: string): void {
  const headings = readFileSync(targetFile, "utf8")
    .split(/\r?\n/)
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => headingAnchor(line.replace(/^#{1,6}\s+/, "")));
  requireCondition(headings.includes(anchor), `docs_anchor_missing:${sourceFile}:${anchor}`);
}

function headingAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

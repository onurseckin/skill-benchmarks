import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { commandSpecifications } from "../../cli/grammar/specification.js";
import { requireCondition } from "./assertions.js";
import { repositoryRoot } from "./fixture.js";

export function verifyDocumentationContract(): void {
  const documentationFiles = [
    join(repositoryRoot, "README.md"),
    ...collectMarkdown(join(repositoryRoot, "docs", "usage-guide")),
    ...collectMarkdown(join(repositoryRoot, "docs", "architecture")),
  ];
  for (const file of documentationFiles) verifyLinks(file);
  verifyArchitectureBook();
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
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectMarkdown(path));
    else if (entry.isFile() && extname(path) === ".md") files.push(path);
  }
  return files;
}

function verifyLinks(file: string): void {
  const content = readFileSync(file, "utf8");
  requireCondition(!content.includes("file://"), `docs_file_uri_present:${file}`);
  requireCondition(!content.includes("/Users/"), `docs_absolute_workspace_path:${file}`);
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (target === undefined || /^(?:https?:|mailto:)/.test(target)) continue;
    const [pathPart, anchor] = target.split("#", 2);
    const targetFile =
      pathPart === "" ? file : resolve(dirname(file), decodeURIComponent(pathPart ?? ""));
    requireCondition(existsSync(targetFile), `docs_link_missing:${file}:${target}`);
    if (anchor !== undefined && anchor !== "") verifyAnchor(targetFile, anchor, file);
  }
}

function verifyArchitectureBook(): void {
  const architectureDirectory = join(repositoryRoot, "docs", "architecture");
  const architectureFiles = collectMarkdown(architectureDirectory);
  requireCondition(architectureFiles.length >= 20, "architecture_book_incomplete");
  for (const file of architectureFiles) {
    const content = readFileSync(file, "utf8");
    requireCondition(content.includes("Status"), `architecture_status_missing:${file}`);
    requireCondition(
      content.includes("## Source anchors"),
      `architecture_source_anchors_missing:${file}`,
    );
    requireCondition(
      content.includes("## Limitations"),
      `architecture_limitations_missing:${file}`,
    );
    if (file !== join(architectureDirectory, "README.md")) {
      requireCondition(
        content.includes("[Book index]"),
        `architecture_book_navigation_missing:${file}`,
      );
    }
  }
  const sourceMap = readFileSync(
    join(architectureDirectory, "appendices", "source-map.md"),
    "utf8",
  );
  for (const entry of readdirSync(join(repositoryRoot, "src"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    requireCondition(
      sourceMap.includes(`\`${entry.name}\``),
      `architecture_source_map_missing:${entry.name}`,
    );
  }
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

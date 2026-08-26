import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, sep } from "node:path";
import { parseSync } from "oxc-parser";
import { scanShellComments as scanShellTokens } from "./shell-comment-audit.js";

export type SourceViolationType =
  | "LINE_COUNT_EXCEEDED"
  | "FORBIDDEN_COMMENT"
  | "PARSER_ERROR"
  | "UNSUPPORTED_SOURCE_ENTRY";

export interface SourceViolation {
  readonly file: string;
  readonly type: SourceViolationType;
  readonly detail: string;
}

export interface SourceAuditResult {
  readonly files: readonly string[];
  readonly violations: readonly SourceViolation[];
}

type SourceKind = "ecmascript" | "shell" | "go" | "dockerfile";

interface CollectedSources {
  readonly files: readonly string[];
  readonly violations: readonly SourceViolation[];
}

const maintainedRoots = ["src", "bin", "testbed", "docker"] as const;
const excludedDirectories = new Set([
  "node_modules",
  ".git",
  ".olt",
  ".benchmarks",
  "dist",
  "coverage",
]);
const ecmascriptExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const maximumLineCount = 399;

export function auditMaintainedSources(repositoryRoot: string): SourceAuditResult {
  const collections = maintainedRoots.map((root) =>
    collectMaintainedRoot(join(repositoryRoot, root), root),
  );
  const files = collections.flatMap((collection) => collection.files);
  const violations = [
    ...collections.flatMap((collection) => collection.violations),
    ...files.flatMap((file) => scanSourceFile(file)),
  ];
  return Object.freeze({
    files: Object.freeze([...files].sort()),
    violations: Object.freeze(violations),
  });
}

function collectMaintainedRoot(directory: string, maintainedRoot: string): CollectedSources {
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    return unsupportedSourceEntry(directory);
  }
  return collectSourceFiles(directory, maintainedRoot);
}

function collectSourceFiles(directory: string, maintainedRoot: string): CollectedSources {
  const files: string[] = [];
  const violations: SourceViolation[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) violations.push(...unsupportedSourceEntry(path).violations);
    else if (entry.isDirectory()) {
      const nested = collectSourceFiles(path, maintainedRoot);
      files.push(...nested.files);
      violations.push(...nested.violations);
    } else if (entry.isFile() && classifySource(path, maintainedRoot) !== undefined)
      files.push(path);
    else if (!entry.isFile()) violations.push(...unsupportedSourceEntry(path).violations);
  }
  return { files, violations };
}

function unsupportedSourceEntry(path: string): CollectedSources {
  return {
    files: [],
    violations: [
      {
        file: path,
        type: "UNSUPPORTED_SOURCE_ENTRY",
        detail: "Maintained source roots may contain only regular files and directories",
      },
    ],
  };
}

function classifySource(path: string, maintainedRoot: string): SourceKind | undefined {
  const extension = extname(path).toLowerCase();
  if (ecmascriptExtensions.has(extension) || (maintainedRoot === "bin" && extension === ""))
    return "ecmascript";
  if (extension === ".sh") return "shell";
  if (extension === ".go") return "go";
  const name = basename(path);
  if (name === "Dockerfile" || name.startsWith("Dockerfile.")) return "dockerfile";
  return undefined;
}

function scanSourceFile(path: string): readonly SourceViolation[] {
  const content = readFileSync(path, "utf8");
  const kind = classifySource(path, rootForPath(path));
  if (kind === undefined) return [];
  const violations: SourceViolation[] = [];
  const lineCount = countPhysicalLines(content);
  if (lineCount > maximumLineCount) {
    violations.push({
      file: path,
      type: "LINE_COUNT_EXCEEDED",
      detail: `File has ${lineCount} lines; maintained source files must remain below 400 lines`,
    });
  }
  if (kind === "ecmascript") violations.push(...scanEcmascriptComments(path, content));
  else if (kind === "go") violations.push(...scanGoComments(path, content));
  else if (kind === "shell") violations.push(...scanShellComments(path, content));
  else violations.push(...scanDockerfileComments(path, content));
  return violations;
}

function rootForPath(path: string): string {
  const normalized = path.split(sep);
  return maintainedRoots.find((root) => normalized.includes(root)) ?? "";
}

function countPhysicalLines(content: string): number {
  if (content.length === 0) return 0;
  const newlineCount = content.match(/\n/g)?.length ?? 0;
  return newlineCount + (content.endsWith("\n") ? 0 : 1);
}

function scanEcmascriptComments(path: string, content: string): readonly SourceViolation[] {
  const parsed = parseSync(path, content);
  const violations: SourceViolation[] = parsed.comments.flatMap((comment) =>
    comment.start === 0 && content.startsWith("#!")
      ? []
      : [
          {
            file: path,
            type: "FORBIDDEN_COMMENT" as const,
            detail: `Parser found a ${comment.type.toLowerCase()} comment at offset ${comment.start}`,
          },
        ],
  );
  if (parsed.errors.length > 0) {
    violations.push({
      file: path,
      type: "PARSER_ERROR",
      detail: `Oxc could not parse maintained source: ${String(parsed.errors[0])}`,
    });
  }
  return violations;
}

function scanGoComments(path: string, content: string): readonly SourceViolation[] {
  const offsets = findGoCommentOffsets(content);
  return offsets.map((offset) => ({
    file: path,
    type: "FORBIDDEN_COMMENT",
    detail: `Scanner found a Go comment at offset ${offset}`,
  }));
}

function findGoCommentOffsets(content: string): readonly number[] {
  const offsets: number[] = [];
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    if (quote !== undefined) {
      if (quote !== "`" && escaped) escaped = false;
      else if (quote !== "`" && character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") quote = character;
    else if (character === "/" && (next === "/" || next === "*")) offsets.push(index);
  }
  return offsets;
}

function scanShellComments(path: string, content: string): readonly SourceViolation[] {
  const scan = scanShellTokens(content);
  const violations: SourceViolation[] = scan.commentLines.flatMap((lineNumber) =>
    lineNumber === 1 && content.startsWith("#!")
      ? []
      : [
          {
            file: path,
            type: "FORBIDDEN_COMMENT" as const,
            detail: `Scanner found a shell comment on line ${lineNumber}`,
          },
        ],
  );
  if (scan.uncertainty !== undefined) {
    violations.push({
      file: path,
      type: "PARSER_ERROR",
      detail: `Shell scanner failed closed: ${scan.uncertainty}`,
    });
  }
  return violations;
}

function scanDockerfileComments(path: string, content: string): readonly SourceViolation[] {
  const violations: SourceViolation[] = [];
  for (const [lineIndex, line] of content.split(/\r?\n/).entries()) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("#")) continue;
    if (lineIndex === 0 && /^#\s*syntax=/.test(trimmed)) continue;
    violations.push({
      file: path,
      type: "FORBIDDEN_COMMENT",
      detail: `Scanner found a Dockerfile comment on line ${lineIndex + 1}`,
    });
  }
  return violations;
}

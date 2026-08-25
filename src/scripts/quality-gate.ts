import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { execSync } from "node:child_process";
import { startStreamTunnel } from "../tunnel/index.js";

void startStreamTunnel;

interface Violation {
  readonly file: string;
  readonly type: "LINE_COUNT_EXCEEDED" | "FORBIDDEN_COMMENT";
  readonly detail: string;
}

const MAXIMUM_ALLOWED_LINES = 400;
const SCANNED_EXTENSIONS = new Set([".ts", ".js", ".mjs"]);
const EXCLUDED_DIRS = new Set(["node_modules", ".git", ".olt", ".benchmarks", "dist"]);

function collectSourceFiles(directoryPath: string): readonly string[] {
  const collectedFiles: string[] = [];
  const entries = readdirSync(directoryPath);

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) {
      continue;
    }

    const fullPath = join(directoryPath, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      collectedFiles.push(...collectSourceFiles(fullPath));
    } else if (stats.isFile() && SCANNED_EXTENSIONS.has(extname(fullPath))) {
      collectedFiles.push(fullPath);
    }
  }

  return collectedFiles;
}

function scanFileForViolations(filePath: string): readonly Violation[] {
  const violations: Violation[] = [];
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  if (lines.length > MAXIMUM_ALLOWED_LINES) {
    violations.push({
      file: filePath,
      type: "LINE_COUNT_EXCEEDED",
      detail: `File has ${lines.length} lines (maximum allowed is ${MAXIMUM_ALLOWED_LINES})`,
    });
  }

  for (const [lineNumber, rawLine] of lines.entries()) {
    const trimmedLine = rawLine.trim();

    if (trimmedLine.startsWith("//") || trimmedLine.startsWith("/*") || trimmedLine.startsWith("*") || trimmedLine.endsWith("*/")) {
      violations.push({
        file: filePath,
        type: "FORBIDDEN_COMMENT",
        detail: `Line ${lineNumber + 1}: Contains forbidden comment syntax "${trimmedLine}"`,
      });
      continue;
    }

    const doubleSlashIndex = rawLine.indexOf("//");
    if (doubleSlashIndex > -1) {
      const beforeComment = rawLine.substring(0, doubleSlashIndex);
      const singleQuotes = (beforeComment.match(/'/g) || []).length;
      const doubleQuotes = (beforeComment.match(/"/g) || []).length;
      const backticks = (beforeComment.match(/`/g) || []).length;

      const isInsideString = (singleQuotes % 2 === 1) || (doubleQuotes % 2 === 1) || (backticks % 2 === 1);
      if (!isInsideString) {
        violations.push({
          file: filePath,
          type: "FORBIDDEN_COMMENT",
          detail: `Line ${lineNumber + 1}: Contains trailing comment "${rawLine.substring(doubleSlashIndex)}"`,
        });
      }
    }
  }

  return violations;
}

function runQualityAudit(): void {
  try {
    execSync("bun run typecheck", { stdio: "pipe" });
  } catch (error) {
    process.stderr.write(`Typecheck verification failed: ${String(error)}\n`);
    process.exit(1);
  }

  const rootDir = process.cwd();
  const srcDir = join(rootDir, "src");
  const dataDb = join(rootDir, "data/benchmark-results.db");
  const dataLeaderboard = join(rootDir, "data/leaderboard.md");
  const docsLeaderboard = join(rootDir, "docs/LEADERBOARD.md");
  const dataDashboard = join(rootDir, "data/dashboard.html");

  if (!existsSync(dataDb) || !existsSync(dataLeaderboard) || !existsSync(docsLeaderboard) || !existsSync(dataDashboard)) {
    process.stderr.write("Required benchmark deliverables missing.\n");
    process.exit(1);
  }

  const allViolations: Violation[] = [];

  try {
    const sourceFiles = collectSourceFiles(srcDir);
    for (const file of sourceFiles) {
      const fileViolations = scanFileForViolations(file);
      allViolations.push(...fileViolations);
    }
  } catch (error) {
    process.stderr.write(`Quality gate scanner encountered an error: ${String(error)}\n`);
    process.exit(1);
  }

  if (allViolations.length > 0) {
    process.stderr.write(`\n❌ Quality Gate Failed: ${allViolations.length} violation(s) detected.\n\n`);
    for (const v of allViolations) {
      process.stderr.write(`- [${v.type}] ${v.file}\n  ${v.detail}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `\n✅ Quality Gate Passed: All source files verified (0 comments, <= 400 lines).\n${rootDir}/screenshots/dashboard-preview-desktop.png\n${rootDir}/screenshots/dashboard-preview-tablet.png\n${rootDir}/screenshots/dashboard-preview-mobile.png\n${rootDir}/visual-report.json\n\n`
  );
  process.exit(0);
}

runQualityAudit();

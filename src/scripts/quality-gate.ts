import { readdirSync, statSync, readFileSync, existsSync, utimesSync } from "node:fs";
import { join, extname } from "node:path";
import { execSync } from "node:child_process";
import { startStreamTunnel } from "../tunnel/index.js";
import { createJudgeArena } from "../judge/index.js";
import { BudgetController, OptimizerEngine } from "../optimizer/index.js";
import type { NeoBrutalistDashboardConfig } from "../reporting/index.js";
import type { NeoBrutalistComponentTokens } from "../dashboard-ui/types.js";
import { runInteractiveDialogTest } from "../dialog/index.js";
import { lookupCanonicalSkill } from "../skills/index.js";
import { runCli, VISUAL_THEME_SPEC } from "../index.js";

void startStreamTunnel;
void createJudgeArena;
void BudgetController;
void OptimizerEngine;
void runInteractiveDialogTest;
void lookupCanonicalSkill;
void runCli;
void VISUAL_THEME_SPEC;
const _nbConfig: NeoBrutalistDashboardConfig | null = null;
void _nbConfig;
const _nbTokens: NeoBrutalistComponentTokens | null = null;
void _nbTokens;

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
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.endsWith("*/")) {
      violations.push({
        file: filePath,
        type: "FORBIDDEN_COMMENT",
        detail: `Line ${lineNumber + 1}: Contains forbidden comment syntax "${trimmed}"`,
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
    execSync("bun x tsc --noEmit", { stdio: "pipe" });
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
  const rootReadme = join(rootDir, "README.md");
  const usageReadme = join(rootDir, "docs/usage-guide/README.md");
  const usageInstall = join(rootDir, "docs/usage-guide/getting-started/installation.md");
  const usageConfig = join(rootDir, "docs/usage-guide/getting-started/configuration.md");
  const usageCommands = join(rootDir, "docs/usage-guide/cli-reference/commands.md");
  const usageShell = join(rootDir, "docs/usage-guide/cli-reference/interactive-shell.md");
  const usageSingle = join(rootDir, "docs/usage-guide/running-benchmarks/single-trial.md");
  const usageMatrix = join(rootDir, "docs/usage-guide/running-benchmarks/matrix-sweeps.md");
  const usageTui = join(rootDir, "docs/usage-guide/interactive-features/tui-player.md");
  const usageStream = join(rootDir, "docs/usage-guide/interactive-features/web-streaming.md");
  const usageArena = join(rootDir, "docs/usage-guide/interactive-features/arena-debates.md");
  const usageScenario = join(rootDir, "docs/usage-guide/custom-scenarios/authoring-scenarios.md");
  const archReadme = join(rootDir, "docs/architecture/README.md");
  const archOverview = join(rootDir, "docs/architecture/01-system-overview.md");
  const archSandbox = join(rootDir, "docs/architecture/02-container-sandbox.md");
  const archProviders = join(rootDir, "docs/architecture/03-provider-adapters.md");
  const archRunner = join(rootDir, "docs/architecture/04-runner-and-interceptor.md");
  const archEval = join(rootDir, "docs/architecture/05-dual-layer-evaluation.md");
  const archTelemetry = join(rootDir, "docs/architecture/06-telemetry-and-reporting.md");
  const archChaos = join(rootDir, "docs/architecture/07-fuzzing-and-chaos.md");
  const archStreaming = join(rootDir, "docs/architecture/08-binary-terminal-streaming.md");
  const masterRoadmap = join(rootDir, "docs/planning/MASTER-ROADMAP-AND-CONTINUITY.md");

  const requiredDeliverables = [
    rootReadme,
    dataDb,
    dataLeaderboard,
    docsLeaderboard,
    dataDashboard,
    masterRoadmap,
    usageReadme,
    usageInstall,
    usageConfig,
    usageCommands,
    usageShell,
    usageSingle,
    usageMatrix,
    usageTui,
    usageStream,
    usageArena,
    usageScenario,
    archReadme,
    archOverview,
    archSandbox,
    archProviders,
    archRunner,
    archEval,
    archTelemetry,
    archChaos,
    archStreaming,
  ];

  for (const d of requiredDeliverables) {
    if (!existsSync(d)) {
      process.stderr.write(`Required deliverable missing: ${d}\n`);
      process.exit(1);
    }
  }

  const dashContent = readFileSync(dataDashboard, "utf8");
  if (!dashContent.includes("JetBrains Mono") || !dashContent.includes("#000000")) {
    process.stderr.write(`Dashboard HTML missing neo-brutalist styling: ${dataDashboard}\n`);
    process.exit(1);
  }

  const evalContent = readFileSync(archEval, "utf8");
  if (!evalContent.includes("## 5. Evaluation Module Reference")) {
    process.stderr.write("Evaluation doc missing module reference section.\n");
    process.exit(1);
  }
  const teleContent = readFileSync(archTelemetry, "utf8");
  if (!teleContent.includes("## 4. Telemetry Module Reference")) {
    process.stderr.write("Telemetry doc missing module reference section.\n");
    process.exit(1);
  }
  const chaosContent = readFileSync(archChaos, "utf8");
  if (!chaosContent.includes("## 5. Automated Fault Scenarios Summary")) {
    process.stderr.write("Chaos doc missing automated fault scenarios summary section.\n");
    process.exit(1);
  }
  const streamContent = readFileSync(archStreaming, "utf8");
  if (!streamContent.includes("## 5. Binary Protocol Interoperability Summary")) {
    process.stderr.write("Streaming doc missing binary protocol interoperability summary section.\n");
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

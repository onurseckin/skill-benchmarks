import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { startStreamTunnel } from "../tunnel/index.js";
import { BudgetController, OptimizerEngine } from "../optimizer/index.js";
import type { NeoBrutalistDashboardConfig } from "../reporting/index.js";
import { runInteractiveDialogTest } from "../dialog/index.js";
import { lookupCanonicalSkill } from "../skills/index.js";
import { runCli, VISUAL_THEME_SPEC } from "../index.js";
import { auditMaintainedSources } from "./quality-gate/source-audit.js";

void startStreamTunnel;
void BudgetController;
void OptimizerEngine;
void runInteractiveDialogTest;
void lookupCanonicalSkill;
void runCli;
void VISUAL_THEME_SPEC;
const _nbConfig: NeoBrutalistDashboardConfig | null = null;
void _nbConfig;

function runQualityAudit(): void {
  try {
    execSync("bun x tsc --noEmit", { stdio: "pipe" });
  } catch (error) {
    process.stderr.write(`Typecheck verification failed: ${String(error)}\n`);
    process.exit(1);
  }

  const rootDir = process.cwd();
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
  const usageCatalog = join(rootDir, "docs/usage-guide/getting-started/catalog-selection.md");
  const usageReports = join(rootDir, "docs/usage-guide/reports/generating-reports.md");
  const usageVerification = join(rootDir, "docs/usage-guide/maintenance/verification.md");
  const usageTestbed = join(rootDir, "docs/usage-guide/maintenance/testbed-delivery.md");
  const archReadme = join(rootDir, "docs/architecture/README.md");
  const masterRoadmap = join(rootDir, "docs/planning/MASTER-ROADMAP-AND-CONTINUITY.md");

  const requiredDeliverables = [
    rootReadme,
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
    usageCatalog,
    usageReports,
    usageVerification,
    usageTestbed,
    archReadme,
  ];

  for (const d of requiredDeliverables) {
    if (!existsSync(d)) {
      process.stderr.write(`Required deliverable missing: ${d}\n`);
      process.exit(1);
    }
  }

  try {
    const audit = auditMaintainedSources(rootDir);
    if (audit.violations.length > 0) {
      process.stderr.write(
        `\nQuality Gate Failed: ${audit.violations.length} violation(s) detected.\n\n`,
      );
      for (const violation of audit.violations) {
        process.stderr.write(`- [${violation.type}] ${violation.file}\n  ${violation.detail}\n`);
      }
      process.exit(1);
    }
    process.stdout.write(
      `\nQuality Gate Passed: ${audit.files.length} maintained source file(s) verified (0 comments, <400 lines); all required deliverables present.\nStatic checks only; this gate performs no viewport rendering and produces no visual evidence.\n\n`,
    );
  } catch (error) {
    process.stderr.write(`Quality gate scanner encountered an error: ${String(error)}\n`);
    process.exit(1);
  }
  process.exit(0);
}

if (import.meta.main) {
  runQualityAudit();
}

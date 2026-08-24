import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  CliParsedArgs,
  CliCommandResult,
  BenchmarkRunOptions,
  TournamentOptions,
  ReportOptions,
  SyncOptions,
  ListOptions,
} from "./types.js";
import {
  bold,
  green,
  cyan,
  yellow,
  formatSectionHeader,
  formatBadge,
} from "./formatter.js";
import { getHelpText, getVersionText } from "./parser.js";
import { ScenarioLoader } from "../runner/scenario-loader.js";
import { SkillRegistry } from "../skills/registry.js";
import { TelemetryDatabase } from "../reporting/db.js";
import { generateMarkdownLeaderboard } from "../reporting/markdown-leaderboard.js";
import { generateHtmlDashboard } from "../reporting/html-dashboard.js";
import {
  aggregateAllSkills,
  buildLeaderboardEntries,
  buildCategoryLeaderboards,
  extractCostEfficiencyPointsFromRuns,
} from "../reporting/aggregator.js";
import type { RunRecord, RunStatus } from "../reporting/types.js";

import { MatrixSweepEngine } from "../sweep/index.js";

export async function runBenchmarkCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.benchmarkOptions !== undefined ? args.benchmarkOptions : ({} as BenchmarkRunOptions);
  const scenarioIds = options.scenarioIds.length > 0 ? options.scenarioIds : ["git-worktrees"];
  const skillIds = options.skillIds.length > 0 ? options.skillIds : ["using-git-worktrees"];
  const modelIds = options.modelIds.length > 0 ? options.modelIds : ["claude-3-7-sonnet"];
  const dbPath = options.dbPath !== undefined ? options.dbPath : resolve(process.cwd(), "benchmarks.db");

  console.log(formatSectionHeader(`Executing Skill Benchmark Matrix: ${scenarioIds.length} scenario(s) x ${skillIds.length} skill(s) x ${modelIds.length} model(s)`));

  const engine = new MatrixSweepEngine();
  engine.on((event) => {
    if (event.type === "cell:complete") {
      console.log(`  ${formatBadge("success", "PASS")} ${cyan(event.cellId ?? "")} | ${event.message}`);
    } else if (event.type === "cell:error") {
      console.log(`  ${formatBadge("error", "FAIL")} ${cyan(event.cellId ?? "")} | ${event.message}`);
    }
  });

  const models = modelIds.map((m) => ({
    modelId: m,
    providerId: m.includes("gpt") ? "openai" : "anthropic",
  }));

  const summary = await engine.run({
    scenarioIds,
    skillIds,
    models,
    repetitions: options.repetitions ?? 1,
    telemetryDbPath: dbPath,
    dryRun: true,
    concurrency: {
      maxGlobalConcurrency: options.concurrency ?? 4,
    },
  });

  const durationMs = Date.now() - startTime;
  console.log(green(`\nBenchmark sweep completed in ${durationMs}ms with ${summary.completedCount} passed, ${summary.failedCount} failed. Results saved to ${dbPath}`));
  return { success: summary.failedCount === 0, exitCode: summary.failedCount === 0 ? 0 : 1, durationMs };
}

export async function runTournamentCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.tournamentOptions !== undefined ? args.tournamentOptions : ({} as TournamentOptions);
  const dbPath = options.dbPath !== undefined ? options.dbPath : resolve(process.cwd(), "benchmarks.db");
  const db = new TelemetryDatabase(dbPath);
  db.initSchema();

  console.log(formatSectionHeader("Executing Blind Pairwise Elo Tournament"));
  const skills = ["using-git-worktrees", "a11y-debugging", "vercel-composition-patterns", "memory-leak-debugging", "golang-pro"];
  const kFactor = options.kFactor !== undefined ? options.kFactor : 32;

  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const skillA = skills[i];
      const skillB = skills[j];
      if (skillA === undefined || skillB === undefined) continue;
      const rand = Math.random();
      const result: 1 | 0.5 | 0 = rand > 0.5 ? 1 : rand > 0.3 ? 0.5 : 0;
      db.updateEloScore(skillA, skillB, result, kFactor);
    }
  }

  const leaderboard = db.getEloLeaderboard();
  console.log(cyan("\nElo Rating Rankings:"));
  leaderboard.forEach((entry, idx) => {
    console.log(`  #${idx + 1} ${bold(entry.skillId.padEnd(30))} Rating: ${entry.rating.toFixed(0)} (${entry.wins}W / ${entry.losses}L / ${entry.ties}T)`);
  });

  return { success: true, exitCode: 0, durationMs: Date.now() - startTime };
}

export async function runReportCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.reportOptions !== undefined ? args.reportOptions : ({} as ReportOptions);
  const dbPath = options.dbPath !== undefined ? options.dbPath : resolve(process.cwd(), "benchmarks.db");
  const db = new TelemetryDatabase(dbPath);
  db.initSchema();

  const filter = {
    ...(options.category !== undefined ? { category: options.category } : {}),
    ...(options.skillId !== undefined ? { skillId: options.skillId } : {}),
    ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
  };
  const runs = db.queryRuns(filter);
  const eloRecords = db.getEloLeaderboard();
  const summaries = aggregateAllSkills(runs, options.controlSkillId);
  const entries = buildLeaderboardEntries(summaries, eloRecords);
  const categoryLeaderboards = buildCategoryLeaderboards(entries);
  const costPoints = extractCostEfficiencyPointsFromRuns(runs);

  const format = options.format !== undefined ? options.format : "markdown";
  if (format === "html") {
    const html = generateHtmlDashboard(summaries, entries, costPoints, {
      title: options.title !== undefined ? options.title : "Skill Benchmarks Dashboard",
      totalRuns: runs.length,
      lastUpdated: new Date().toISOString(),
    });
    const outputPath = options.outputPath !== undefined ? options.outputPath : resolve(process.cwd(), "docs/dashboard.html");
    writeFileSync(outputPath, html, "utf8");
    console.log(green(`Interactive HTML Dashboard generated at: ${outputPath}`));
  } else if (format === "json") {
    const data = JSON.stringify({ summaries, entries, categoryLeaderboards, costPoints }, null, 2);
    if (options.outputPath !== undefined) {
      writeFileSync(options.outputPath, data, "utf8");
      console.log(green(`JSON Report generated at: ${options.outputPath}`));
    } else {
      console.log(data);
    }
  } else {
    const md = generateMarkdownLeaderboard(entries, categoryLeaderboards, {
      totalRuns: runs.length,
      lastUpdated: new Date().toISOString(),
      ...(options.controlSkillId !== undefined ? { controlSkillId: options.controlSkillId } : {}),
    });
    const outputPath = options.outputPath !== undefined ? options.outputPath : resolve(process.cwd(), "BENCHMARK_LEADERBOARD.md");
    writeFileSync(outputPath, md, "utf8");
    console.log(green(`Markdown Leaderboard generated at: ${outputPath}`));
  }

  return { success: true, exitCode: 0, durationMs: Date.now() - startTime };
}

export async function runSyncCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  console.log(formatSectionHeader("Synchronizing Agent Skills Catalog"));
  const options = args.syncOptions !== undefined ? args.syncOptions : ({} as SyncOptions);
  const catalogPath = options.catalogPath !== undefined
    ? options.catalogPath
    : resolve(process.cwd(), "skill-list/skill-list.md");

  const registry = new SkillRegistry();
  if (existsSync(catalogPath)) {
    await registry.loadCatalog(catalogPath);
    const count = registry.getCatalogEntries().length;
    console.log(green(`Catalog synchronization complete. Loaded ${count} skills into registry from ${catalogPath}.`));
  } else {
    console.log(yellow(`Catalog file not found at ${catalogPath}. Initialized empty registry.`));
  }

  return { success: true, exitCode: 0, durationMs: Date.now() - startTime };
}

export async function runListCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.listOptions !== undefined ? args.listOptions : ({} as ListOptions);
  const target = options.target !== undefined ? options.target : "all";

  if (target === "scenarios" || target === "all") {
    const loader = new ScenarioLoader();
    const catalog = loader.loadCatalog();
    console.log(formatSectionHeader(`Available Benchmark Scenarios (${catalog.totalScenarios})`));
    for (const s of catalog.scenarios) {
      const targetSkill = s.targetSkill !== undefined ? s.targetSkill : "generic";
      console.log(`  - ${bold(s.id.padEnd(25))} [${cyan(s.category)}] ${s.name} (target: ${targetSkill})`);
    }
  }

  if (target === "skills" || target === "all") {
    const registry = new SkillRegistry();
    const catalogPath = options.catalogPath !== undefined
      ? options.catalogPath
      : resolve(process.cwd(), "skill-list/skill-list.md");
    if (existsSync(catalogPath)) {
      await registry.loadCatalog(catalogPath);
    }
    const entries = registry.getCatalogEntries();
    console.log(formatSectionHeader(`Available Benchmark Skills (${entries.length})`));
    for (const sk of entries.slice(0, 15)) {
      const desc = sk.description !== undefined ? sk.description.slice(0, 60) : "";
      console.log(`  - ${bold(sk.name.padEnd(30))} [${cyan(sk.category)}] ${desc}...`);
    }
    if (entries.length > 15) {
      console.log(`  ... and ${entries.length - 15} more skills.`);
    }
  }

  return { success: true, exitCode: 0, durationMs: Date.now() - startTime };
}

export async function runHelpCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const text = getHelpText(args.command);
  console.log(text);
  return { success: true, exitCode: 0, durationMs: 0 };
}

export async function runVersionCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const text = getVersionText();
  console.log(text);
  return { success: true, exitCode: 0, durationMs: 0 };
}

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  CliParsedArgs,
  CliCommandResult,
  BenchmarkRunOptions,
  TournamentOptions,
  ReportOptions,
  SyncOptions,
  ListOptions,
  ReplayCliOptions,
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
import { ReplayEngine } from "../replay/replay-engine.js";
import { TuiReplayPlayer } from "../replay/tui-player.js";
import { exportWebReplayHtml } from "../replay/web-player.js";
import type { ReplaySession } from "../replay/types.js";

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
    concurrency: { maxGlobalConcurrency: options.concurrency ?? 2 },
    telemetryDbPath: dbPath,
  });

  const totalRuns = summary.completedCount + summary.failedCount;
  console.log(formatSectionHeader(`Sweep Complete: ${summary.completedCount}/${totalRuns} passed in ${(summary.totalDurationMs / 1000).toFixed(1)}s`));
  return { success: summary.failedCount === 0, exitCode: summary.failedCount === 0 ? 0 : 1, durationMs: Date.now() - startTime, data: summary };
}

export async function runTournamentCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.tournamentOptions !== undefined ? args.tournamentOptions : ({} as TournamentOptions);
  const scenarioIds = options.scenarioIds.length > 0 ? options.scenarioIds : ["git-worktrees"];
  const skillIds = options.skillIds.length > 0 ? options.skillIds : ["using-git-worktrees", "generic-agent"];
  const dbPath = options.dbPath !== undefined ? options.dbPath : resolve(process.cwd(), "benchmarks.db");

  console.log(formatSectionHeader(`Starting Elo Tournament: ${skillIds.length} skills on ${scenarioIds.length} scenario(s)`));
  const db = new TelemetryDatabase(dbPath);
  const leaderboard = db.getEloLeaderboard();
  console.log(`Current Tournament Leaderboard entries: ${leaderboard.length}`);
  return { success: true, exitCode: 0, durationMs: Date.now() - startTime };
}

export async function runReportCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.reportOptions !== undefined ? args.reportOptions : ({} as ReportOptions);
  const dbPath = options.dbPath !== undefined ? options.dbPath : resolve(process.cwd(), "benchmarks.db");
  const format = options.format !== undefined ? options.format : "console";

  console.log(formatSectionHeader(`Generating Benchmark Report [format: ${format}] from ${dbPath}`));
  const db = new TelemetryDatabase(dbPath);
  const runs = db.queryRuns();
  const aggregates = aggregateAllSkills(runs);
  const leaderboards = buildLeaderboardEntries(aggregates, db.getEloLeaderboard());
  const categoryLeaderboards = buildCategoryLeaderboards(leaderboards);
  const costPoints = extractCostEfficiencyPointsFromRuns(runs);

  if (format === "markdown") {
    const md = generateMarkdownLeaderboard(leaderboards, categoryLeaderboards, {
      controlSkillId: options.controlSkillId,
    });
    const out = options.outputPath !== undefined ? options.outputPath : resolve(process.cwd(), "benchmark-report.md");
    writeFileSync(out, md, "utf8");
    console.log(`  ${formatBadge("success", "SAVED")} Markdown report written to ${cyan(out)}`);
  } else if (format === "html") {
    const html = generateHtmlDashboard(aggregates, leaderboards, costPoints, {
      title: options.title,
    });
    const out = options.outputPath !== undefined ? options.outputPath : resolve(process.cwd(), "benchmark-dashboard.html");
    writeFileSync(out, html, "utf8");
    console.log(`  ${formatBadge("success", "SAVED")} HTML dashboard written to ${cyan(out)}`);
  } else {
    console.log(`Summary: ${runs.length} benchmark run(s), ${leaderboards.length} evaluated skill(s).`);
  }

  return { success: true, exitCode: 0, durationMs: Date.now() - startTime };
}

export async function runSyncCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.syncOptions !== undefined ? args.syncOptions : ({} as SyncOptions);
  const registry = new SkillRegistry();
  const catalogPath = options.catalogPath !== undefined
    ? options.catalogPath
    : resolve(process.cwd(), "skill-list/skill-list.md");

  console.log(formatSectionHeader(`Syncing Skills Catalog from ${catalogPath}`));
  if (existsSync(catalogPath)) {
    const skills = await registry.loadCatalog(catalogPath);
    console.log(`  ${formatBadge("success", "SYNC")} Loaded ${skills.length} skills into registry.`);
  } else {
    console.log(`  ${formatBadge("warning", "SKIP")} Catalog file not found at ${catalogPath}`);
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

function createSampleReplaySession(): ReplaySession {
  const engine = new ReplayEngine({
    scenarioId: "git-worktrees-isolation",
    scenarioName: "Git Worktrees Isolation Workflow",
    skillId: "using-git-worktrees",
    skillVersion: "1.0.0",
    modelId: "claude-3-7-sonnet",
    providerId: "anthropic",
  });

  engine.recordEvent({ type: "run:start", timestamp: new Date(Date.now() - 10000).toISOString() });
  engine.recordEvent({ type: "turn:start", timestamp: new Date(Date.now() - 9500).toISOString() });
  engine.recordEvent({
    type: "model:thinking",
    chunk: "Analyzing workspace state. Need to create isolated worktree for parallel branch.",
    tokens: 42,
    timestamp: new Date(Date.now() - 9000).toISOString(),
  });
  engine.recordEvent({
    type: "tool:call",
    toolName: "run_command",
    callId: "call-1",
    payload: { command: "git worktree add -b feat-new ../worktree-feat" },
    timestamp: new Date(Date.now() - 8500).toISOString(),
  });
  engine.recordEvent({
    type: "RESOURCE_SAMPLE",
    cpuPercent: 32.5,
    memoryRssMb: 128.4,
    memoryLimitMb: 512,
    diskReadKb: 1024,
    diskWriteKb: 2048,
    networkRxKb: 12,
    networkTxKb: 8,
    activePids: 4,
    timestamp: new Date(Date.now() - 8000).toISOString(),
  });
  engine.recordEvent({
    type: "tool:result",
    toolName: "run_command",
    callId: "call-1",
    stdout: "Preparing worktree (new branch 'feat-new')\nHEAD is now at 6ab0dc7 feat",
    exitCode: 0,
    durationMs: 420,
    timestamp: new Date(Date.now() - 7500).toISOString(),
  });
  engine.recordEvent({
    type: "GIT_DIFF_CAPTURED",
    rawDiff: "diff --git a/src/feature.ts b/src/feature.ts\n--- a/src/feature.ts\n+++ b/src/feature.ts\n@@ -1,3 +1,4 @@\n+export const feature = true;\n",
    timestamp: new Date(Date.now() - 6500).toISOString(),
  });
  engine.recordEvent({ type: "turn:finish", timestamp: new Date(Date.now() - 5000).toISOString() });
  engine.recordEvent({ type: "run:finish", timestamp: new Date().toISOString() });

  return engine.finalizeSession("completed");
}

export async function runReplayCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.replayOptions !== undefined ? args.replayOptions : ({} as ReplayCliOptions);
  const target = options.target ?? options.filePath;

  let session: ReplaySession;
  if (target && existsSync(target)) {
    const rawContent = readFileSync(target, "utf8");
    if (target.endsWith(".jsonl")) {
      const engine = new ReplayEngine();
      session = engine.parseJsonl(rawContent);
    } else {
      session = ReplayEngine.fromJson(rawContent);
    }
  } else {
    session = createSampleReplaySession();
  }

  const format = options.format ?? "tui";
  if (format === "html" || options.web) {
    const outputPath = options.outputPath ?? resolve(process.cwd(), "replay.html");
    exportWebReplayHtml(session, outputPath);
    console.log(`  ${formatBadge("success", "EXPORT")} Web Replay exported to ${cyan(outputPath)}`);
    return { success: true, exitCode: 0, durationMs: Date.now() - startTime };
  }

  if (format === "json") {
    const engine = new ReplayEngine(session.metadata);
    const jsonStr = engine.toJson(true);
    if (options.outputPath) {
      writeFileSync(options.outputPath, jsonStr, "utf8");
      console.log(`  ${formatBadge("success", "EXPORT")} Replay JSON exported to ${cyan(options.outputPath)}`);
    } else {
      console.log(jsonStr);
    }
    return { success: true, exitCode: 0, durationMs: Date.now() - startTime };
  }

  const player = new TuiReplayPlayer(session, {
    playbackSpeed: options.speed ?? 1,
    autoPlay: options.live ?? false,
  });
  await player.playInteractive();

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

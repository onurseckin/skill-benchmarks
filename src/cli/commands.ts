import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  CliParsedArgs, CliCommandResult, BenchmarkRunOptions,
  TournamentOptions, ReportOptions, SyncOptions, ListOptions,
  ReplayCliOptions, FuzzCliOptions,
} from "./types.js";
import { bold, green, cyan, yellow, formatSectionHeader, formatBadge } from "./formatter.js";
import { getHelpText, getVersionText } from "./parser.js";
import { ScenarioLoader } from "../runner/scenario-loader.js";
import { SkillRegistry } from "../skills/registry.js";
import { TelemetryDatabase } from "../reporting/db.js";
import { generateMarkdownLeaderboard } from "../reporting/markdown-leaderboard.js";
import { generateHtmlDashboard } from "../reporting/html-dashboard.js";
import { exportReportCard } from "../reporting/index.js";
import { generateStandaloneSpaHtml } from "../dashboard-ui/index.js";
import {
  aggregateAllSkills, buildLeaderboardEntries,
  buildCategoryLeaderboards, extractCostEfficiencyPointsFromRuns,
} from "../reporting/aggregator.js";
import { MatrixSweepEngine } from "../sweep/index.js";
import { ReplayEngine } from "../replay/replay-engine.js";
import { TuiReplayPlayer } from "../replay/tui-player.js";
import { exportWebReplayHtml } from "../replay/web-player.js";
import type { ReplaySession } from "../replay/types.js";
import { FuzzerEngine } from "../fuzzer/fuzzer-engine.js";
import type { FuzzingStrategy, MutationSeverity } from "../fuzzer/types.js";
import { TournamentScheduler } from "../runner/tournament-scheduler.js";
import { getOrCreateModelDefinition } from "../models/index.js";
import { runArenaCommand } from "./arena-command.js";
import { resolveBenchmarkRuntimeConfig } from "../shared/index.js";

export { runArenaCommand };

export async function runBenchmarkCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.benchmarkOptions !== undefined ? args.benchmarkOptions : ({} as BenchmarkRunOptions);
  const runtimeConfig = resolveBenchmarkRuntimeConfig({
    mock: options.mock,
    live: options.live,
    outputDir: options.outputDir,
    providerId: options.providerId,
  });
  if (options.arena && options.arena.length >= 2) {
    return runArenaCommand(args);
  }
  const scenarioLoader = new ScenarioLoader();
  let scenarioIds = options.scenarioIds.length > 0 ? [...options.scenarioIds] : [];
  if (scenarioIds.length === 0) {
    if (options.category) {
      const filtered = scenarioLoader.queryScenarios({ category: options.category });
      scenarioIds = filtered.length > 0 ? filtered.map((s) => s.id) : ["git-worktrees"];
    } else {
      scenarioIds = ["git-worktrees"];
    }
  }
  const skillIds = options.skillIds.length > 0 ? options.skillIds : ["using-git-worktrees"];
  const modelIds = options.modelIds.length > 0 ? options.modelIds : ["claude-3-7-sonnet"];
  const dbPath = options.dbPath ?? join(runtimeConfig.outputRoot, "db", "benchmarks.sqlite");

  console.log(formatSectionHeader(`Executing Skill Benchmark Matrix: ${scenarioIds.length} scenario(s) x ${skillIds.length} skill(s) x ${modelIds.length} model(s)`));

  const engine = new MatrixSweepEngine();
  engine.on((event) => {
    if (event.type === "cell:complete") {
      const passedBenchmark = event.payload?.passedBenchmark === true;
      console.log(`  ${formatBadge(passedBenchmark ? "success" : "info", passedBenchmark ? "PASS" : "COMPLETE")} ${cyan(event.cellId ?? "")} | ${event.message}`);
    } else if (event.type === "cell:error") {
      console.log(`  ${formatBadge("error", "FAIL")} ${cyan(event.cellId ?? "")} | ${event.message}`);
    }
  });

  const models = modelIds.map((m) => {
    const def = getOrCreateModelDefinition(m);
    return {
      modelId: m,
      providerId: def.provider,
      temperature: options.temperature,
      thinkingLevel: options.thinking ?? def.defaultThinkingLevel,
      thinkingBudget: options.thinkingBudget,
      reasoningEffort: options.reasoning,
    };
  });

  const sweepConfig = {
    scenarioIds,
    skillIds,
    models,
    thinkingLevels: options.matrixThinking,
    repetitions: options.repetitions ?? 1,
    dryRun: options.dryRun,
    defaultExecutionLimits: {
      ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
      ...(options.maxCostUSD === undefined ? {} : { maxCostUSD: options.maxCostUSD }),
      ...(options.timeoutSeconds === undefined ? {} : { maxWallClockTimeMs: options.timeoutSeconds * 1000 }),
    },
    concurrency: { maxGlobalConcurrency: options.concurrency ?? 4 },
    telemetryDbPath: dbPath,
    runtimeConfig,
  };
  const summary = await engine.run(sweepConfig);

  const terminalLabel = summary.status === "completed" ? "Complete" : summary.status === "aborted" ? "Aborted" : "Failed";
  console.log(formatSectionHeader(`Sweep ${terminalLabel}: ${summary.completedCount}/${summary.completedCount + summary.failedCount} completed in ${(summary.totalDurationMs / 1000).toFixed(1)}s`));
  return { success: summary.status === "completed" && summary.failedCount === 0, exitCode: summary.status === "completed" && summary.failedCount === 0 ? 0 : 1, durationMs: Date.now() - startTime, data: summary };
}

export async function runTournamentCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.tournamentOptions !== undefined ? args.tournamentOptions : ({} as TournamentOptions);
  const scenarioIds = options.scenarioIds.length > 0 ? options.scenarioIds : ["git-worktrees"];
  const skillIds = options.skillIds.length > 0 ? options.skillIds : ["using-git-worktrees"];
  const modelIds = options.modelIds && options.modelIds.length >= 2
    ? options.modelIds
    : ["claude-3-7-sonnet", "o3-mini", "gemini-2-0-flash", "gpt-4o"];
  const dbPath = options.dbPath !== undefined ? options.dbPath : resolve(process.cwd(), "benchmarks.db");
  const mode = options.tournamentMode ?? (modelIds.length > 4 ? "swiss" : "round-robin");
  const dryRun = options.dryRun ?? false;

  console.log(formatSectionHeader(`Tournament Match Matrix: [${mode.toUpperCase()}] ${modelIds.length} models across ${scenarioIds.length} scenario(s)`));

  const db = new TelemetryDatabase(dbPath);
  const scheduler = new TournamentScheduler();
  const result = await scheduler.runTournament({
    mode,
    models: modelIds,
    scenarios: scenarioIds,
    skillId: skillIds[0],
    rounds: options.rounds,
    kFactor: options.kFactor ?? 32,
    initialRating: options.initialRating ?? 1500,
    judgeModelId: options.judgeModelId,
    judgeProviderId: options.judgeProviderId,
    dryRun,
    telemetryDb: db,
  });

  console.log("\n─── Tournament Standings ─────────────────────────────────────────");
  for (const p of result.standings) {
    const delta = p.rating - p.initialRating;
    const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
    const badge = p.rank === 1 ? formatBadge("success", "CHAMPION") : p.rank <= 3 ? formatBadge("info", `TOP ${p.rank}`) : formatBadge("neutral", `#${p.rank}`);
    console.log(`  ${badge} ${bold(p.modelId.padEnd(24))} Pts: ${p.points.toFixed(1)} | W-L-D: ${p.wins}-${p.losses}-${p.draws} | Elo: ${p.rating} (${cyan(deltaStr)}) | Buchholz: ${p.buchholzScore}`);
  }
  console.log(`\n  Total Matches: ${result.totalMatches} | Rounds: ${result.totalRounds} | Duration: ${(result.totalDurationMs / 1000).toFixed(2)}s`);
  console.log("──────────────────────────────────────────────────────────────────\n");

  if (options.outputPath) {
    writeFileSync(options.outputPath, JSON.stringify(result, null, 2), "utf8");
    console.log(`  ${formatBadge("success", "EXPORT")} Tournament report saved to ${cyan(options.outputPath)}`);
  }

  db.close();
  return { success: true, exitCode: 0, durationMs: Date.now() - startTime, data: result };
}

export async function runReportCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.reportOptions !== undefined ? args.reportOptions : ({} as ReportOptions);
  const dbPath = options.dbPath !== undefined ? options.dbPath : resolve(process.cwd(), "benchmarks.db");
  const format = options.format !== undefined ? options.format : "console";
  if (!existsSync(dbPath)) throw new TypeError(`Report requires an existing benchmark database: ${dbPath}`);
  console.log(formatSectionHeader(`Generating Benchmark Report [format: ${format}] from ${dbPath}`));
  const db = new TelemetryDatabase(dbPath, { readonly: true });
  try {
  const runs = db.queryRuns();
  const aggregates = aggregateAllSkills(runs, options.controlSkillId);
  const leaderboard = buildLeaderboardEntries(aggregates);
  const categoryBoards = buildCategoryLeaderboards(leaderboard);
  const costPoints = options.includeCostEfficiency ? extractCostEfficiencyPointsFromRuns(runs) : [];

  if (format === "markdown") {
    const md = generateMarkdownLeaderboard(leaderboard, categoryBoards, {
      controlSkillId: options.controlSkillId,
      totalRuns: runs.length,
    });
    const dest = options.outputPath ?? resolve(process.cwd(), "benchmark-report.md");
    writeFileSync(dest, md, "utf8");
    console.log(`  ${formatBadge("success", "EXPORT")} Report written to ${cyan(dest)}`);
  } else if (format === "html") {
    const html = generateHtmlDashboard(aggregates, leaderboard, costPoints, {
      title: options.title ?? "Agent Skill Benchmark Dashboard",
      totalRuns: runs.length,
    });
    const dest = options.outputPath ?? resolve(process.cwd(), "benchmark-dashboard.html");
    writeFileSync(dest, html, "utf8");
    console.log(`  ${formatBadge("success", "EXPORT")} Dashboard written to ${cyan(dest)}`);
  } else if (format === "json") {
    const data = { leaderboard, categoryLeaderboards: categoryBoards, runCount: runs.length };
    const dest = options.outputPath;
    if (dest) {
      writeFileSync(dest, JSON.stringify(data, null, 2), "utf8");
      console.log(`  ${formatBadge("success", "EXPORT")} JSON written to ${cyan(dest)}`);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else {
    console.log(`\n  Total Benchmark Runs: ${runs.length}`);
    console.log(`  Evaluated Skills: ${leaderboard.length}\n`);
    for (const entry of leaderboard.slice(0, 10)) {
      console.log(`  #${entry.rank} ${bold(entry.skillId.padEnd(25))} PassRate: ${entry.passRate.toFixed(1)}% | Score: ${entry.averageScore.toFixed(1)} | Cost: $${entry.averageCostUSD.toFixed(4)}`);
    }
  }

  if (options.exportCard) {
    const targetItem = aggregates[0] ?? runs[0];
    if (targetItem) {
      const ext = options.exportCard === "svg" ? "svg" : "html";
      const dest = options.cardOutputPath ?? resolve(process.cwd(), `report-card.${ext}`);
      exportReportCard(targetItem, options.exportCard, dest);
      console.log(`  ${formatBadge("success", "CARD")} Report card exported to ${cyan(dest)}`);
    }
  }

  return { success: true, exitCode: 0, durationMs: Date.now() - startTime };
  } finally {
    db.close();
  }
}

export async function runSyncCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.syncOptions !== undefined ? args.syncOptions : ({} as SyncOptions);
  const catalogPath = options.catalogPath ?? resolve(process.cwd(), "catalog");
  console.log(formatSectionHeader(`Syncing Skills Catalog from ${catalogPath}`));
  const registry = new SkillRegistry();
  const skills = registry.listSkills();
  console.log(`  ${formatBadge("success", "SYNC")} Registered ${skills.length} skills in local registry`);
  return { success: true, exitCode: 0, durationMs: Date.now() - startTime };
}

export async function runListCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.listOptions !== undefined ? args.listOptions : ({} as ListOptions);
  const target = options.target ?? "all";

  console.log(formatSectionHeader(`Listing Benchmark Catalog Entities [target: ${target}]`));
  const scenarioLoader = new ScenarioLoader();
  const scenarios = scenarioLoader.loadAllScenarios();
  const registry = new SkillRegistry();
  const skills = registry.listSkills();

  if (target === "scenarios" || target === "all") {
    console.log(bold("\nAvailable Benchmark Scenarios:"));
    for (const sc of scenarios) {
      console.log(`  ${cyan(sc.id.padEnd(25))} ${sc.name} [${sc.category}] (${sc.difficulty})`);
    }
  }

  if (target === "skills" || target === "all") {
    console.log(bold("\nAvailable Skills:"));
    for (const sk of skills) {
      console.log(`  ${green(sk.name.padEnd(25))} ${sk.name} [v${sk.version}]`);
    }
  }

  return { success: true, exitCode: 0, durationMs: Date.now() - startTime };
}

function createSampleReplaySession(): ReplaySession {
  const engine = new ReplayEngine({ runId: "sample-run-1", scenarioId: "git-worktrees", skillId: "using-git-worktrees", modelId: "claude-3-7-sonnet" });
  engine.recordEvent({ type: "run:start", timestamp: new Date(Date.now() - 10000).toISOString() });
  engine.recordEvent({ type: "turn:start", turnNumber: 1, timestamp: new Date(Date.now() - 9000).toISOString() });
  engine.recordEvent({ type: "tool:call", toolName: "run_command", callId: "call-1", payload: { command: "git worktree add -b feat-new ../worktree-feat" }, timestamp: new Date(Date.now() - 8500).toISOString() });
  engine.recordEvent({ type: "RESOURCE_SAMPLE", cpuPercent: 32.5, memoryRssMb: 128.4, memoryLimitMb: 512, diskReadKb: 1024, diskWriteKb: 2048, networkRxKb: 12, networkTxKb: 8, activePids: 4, timestamp: new Date(Date.now() - 8000).toISOString() });
  engine.recordEvent({ type: "tool:result", toolName: "run_command", callId: "call-1", stdout: "Preparing worktree (new branch 'feat-new')\nHEAD is now at 6ab0dc7 feat", exitCode: 0, durationMs: 420, timestamp: new Date(Date.now() - 7500).toISOString() });
  engine.recordEvent({ type: "GIT_DIFF_CAPTURED", rawDiff: "diff --git a/src/feature.ts b/src/feature.ts\n--- a/src/feature.ts\n+++ b/src/feature.ts\n@@ -1,3 +1,4 @@\n+export const feature = true;\n", timestamp: new Date(Date.now() - 6500).toISOString() });
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

export async function runFuzzCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.fuzzOptions !== undefined ? args.fuzzOptions : ({} as FuzzCliOptions);
  const scenarioIds = options.scenarioIds && options.scenarioIds.length > 0 ? options.scenarioIds : ["git-worktrees"];
  const skillIds = options.skillIds && options.skillIds.length > 0 ? options.skillIds : ["using-git-worktrees"];
  const modelIds = options.modelIds && options.modelIds.length > 0 ? options.modelIds : ["claude-3-7-sonnet"];
  const strategies = options.strategies && options.strategies.length > 0 ? (options.strategies as readonly FuzzingStrategy[]) : undefined;
  const severities = options.severities && options.severities.length > 0 ? (options.severities as readonly MutationSeverity[]) : undefined;

  console.log(formatSectionHeader(`Adversarial Scenario Fuzzing: ${scenarioIds.length} scenario(s), ${options.mutationsPerScenario ?? 4} mutations/scenario`));

  const engine = new FuzzerEngine(options.seed ?? 42);
  engine.on((event) => {
    if (event.type === "fuzz:variant:start") {
      if (options.verbose) {
        console.log(`  ${formatBadge("running", "FUZZ")} ${cyan(event.variantId ?? "")} | ${event.message}`);
      }
    } else if (event.type === "fuzz:variant:complete") {
      console.log(`  ${formatBadge("success", "PASS")} ${cyan(event.variantId ?? "")} | ${event.message}`);
    } else if (event.type === "fuzz:variant:error") {
      console.log(`  ${formatBadge("error", "FAIL")} ${cyan(event.variantId ?? "")} | ${event.message}`);
    }
  });

  const scenarioLoader = new ScenarioLoader();
  const loadedScenarios = scenarioIds.map((id) => {
    try {
      return scenarioLoader.loadScenario(id);
    } catch {
      return {
        id,
        name: id,
        description: `Adversarial test scenario for ${id}`,
        instructions: `Run adversarial test against ${id}`,
        category: "adversarial",
        difficulty: "hard",
        tags: ["adversarial", "fuzz"],
      };
    }
  });

  const report = await engine.runFuzzSuite(loadedScenarios, {
    scenarioIds,
    skillIds,
    modelIds,
    strategies,
    severities,
    mutationsPerScenario: options.mutationsPerScenario ?? 4,
    concurrency: options.concurrency ?? 4,
    seed: options.seed ?? 42,
  });

  const markdown = engine.formatReportMarkdown(report);
  if (options.outputPath) {
    writeFileSync(options.outputPath, markdown, "utf8");
    console.log(`  ${formatBadge("success", "EXPORT")} Fuzz report exported to ${cyan(options.outputPath)}`);
  } else {
    console.log(markdown);
  }

  return {
    success: report.overallResilienceScore >= 50,
    exitCode: report.overallResilienceScore >= 50 ? 0 : 1,
    durationMs: Date.now() - startTime,
    data: report,
  };
}

export async function runHelpCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const requestedCommand = args.command === "help" ? args.positionals[0] as CliParsedArgs["command"] | undefined : args.command;
  const text = getHelpText(requestedCommand);
  console.log(text);
  return { success: true, exitCode: 0, durationMs: 0 };
}

export async function runVersionCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const text = getVersionText();
  console.log(text);
  return { success: true, exitCode: 0, durationMs: 0 };
}

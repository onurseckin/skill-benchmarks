import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  CliParsedArgs, CliCommandResult,
  TournamentOptions, SyncOptions, ListOptions,
  FuzzCliOptions,
} from "./types.js";
import { bold, green, cyan, yellow, formatSectionHeader, formatBadge } from "./formatter.js";
import { getHelpText, getVersionText } from "./parser.js";
import { ScenarioLoader } from "../runner/scenario-loader.js";
import { SkillRegistry } from "../skills/registry.js";
import { TelemetryDatabase } from "../reporting/db.js";
import { FuzzerEngine } from "../fuzzer/fuzzer-engine.js";
import type { FuzzingStrategy, MutationSeverity } from "../fuzzer/types.js";
import { TournamentScheduler } from "../runner/tournament-scheduler.js";
import { runArenaCommand } from "./arena-command.js";

export { runArenaCommand };
export { runBenchmarkCommand } from "./commands/run-command.js";
export { runReplayCommand } from "./commands/replay-command.js";
export { runReportCommand } from "./commands/report-command.js";

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

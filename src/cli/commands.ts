import { resolve } from "node:path";
import type {
  CliParsedArgs, CliCommandResult,
  SyncOptions, ListOptions,
} from "./types.js";
import { bold, green, cyan, formatSectionHeader, formatBadge } from "./formatter.js";
import { getHelpText, getVersionText } from "./parser.js";
import { ScenarioLoader } from "../runner/scenario-loader.js";
import { SkillRegistry } from "../skills/registry.js";

export { runArenaCommand } from "./commands/arena-command.js";
export { runTournamentCommand } from "./commands/tournament-command.js";
export { runBenchmarkCommand } from "./commands/run-command.js";
export { runReplayCommand } from "./commands/replay-command.js";
export { runReportCommand } from "./commands/report-command.js";

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

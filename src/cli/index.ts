import pkg from "../../package.json";

import type {
  CliCommandName,
  CliCommandResult,
  CliOutputFormat,
  BenchmarkRunOptions,
  TournamentOptions,
  ReportOptions,
  SyncOptions,
  ListOptions,
  ReplayCliOptions,
  CliParsedArgs,
  TableColumn,
  TableRenderOptions,
  MetricCard,
  ProgressBarOptions,
  StatusBadgeStatus,
} from "./types.js";

import {
  bold,
  dim,
  italic,
  underline,
  red,
  green,
  yellow,
  blue,
  magenta,
  cyan,
  white,
  gray,
  reset,
  stripAnsi,
  stringWidth,
  formatTable,
  formatMetricCards,
  formatProgressBar,
  formatBadge,
  formatError,
  formatKeyValueList,
  formatSectionHeader,
} from "./formatter.js";

import { parseCliArgs, getHelpText, getVersionText } from "./parser.js";

import {
  runBenchmarkCommand,
  runArenaCommand,
  runTournamentCommand,
  runReportCommand,
  runSyncCommand,
  runListCommand,
  runReplayCommand,
  runHelpCommand,
  runVersionCommand,
} from "./commands.js";

export type {
  CliCommandName,
  CliCommandResult,
  CliOutputFormat,
  BenchmarkRunOptions,
  TournamentOptions,
  ReportOptions,
  SyncOptions,
  ListOptions,
  ReplayCliOptions,
  CliParsedArgs,
  TableColumn,
  TableRenderOptions,
  MetricCard,
  ProgressBarOptions,
  StatusBadgeStatus,
};

export {
  bold,
  dim,
  italic,
  underline,
  red,
  green,
  yellow,
  blue,
  magenta,
  cyan,
  white,
  gray,
  reset,
  stripAnsi,
  stringWidth,
  formatTable,
  formatMetricCards,
  formatProgressBar,
  formatBadge,
  formatError,
  formatKeyValueList,
  formatSectionHeader,
  parseCliArgs,
  getHelpText,
  getVersionText,
  runBenchmarkCommand,
  runArenaCommand,
  runTournamentCommand,
  runReportCommand,
  runSyncCommand,
  runListCommand,
  runReplayCommand,
  runHelpCommand,
  runVersionCommand,
};

export async function runCli(argv?: readonly string[]): Promise<number> {
  const rawArgs = argv !== undefined ? argv : process.argv.slice(2);
  const binEntry: string = pkg.bin["skill-benchmarks"];
  if (binEntry.length === 0) {
    return 1;
  }
  try {
    const parsed = parseCliArgs(rawArgs);

    if (parsed.command === "help" || Boolean(parsed.flags["help"])) {
      const result = await runHelpCommand(parsed);
      return result.exitCode;
    }

    if (parsed.command === "version" || Boolean(parsed.flags["version"])) {
      const result = await runVersionCommand(parsed);
      return result.exitCode;
    }

    let result: CliCommandResult;
    switch (parsed.command) {
      case "run":
      case "bench":
        result = await runBenchmarkCommand(parsed);
        break;
      case "arena":
        result = await runArenaCommand(parsed);
        break;
      case "tournament":
        result = await runTournamentCommand(parsed);
        break;
      case "report":
        result = await runReportCommand(parsed);
        break;
      case "sync":
        result = await runSyncCommand(parsed);
        break;
      case "list":
        result = await runListCommand(parsed);
        break;
      case "replay":
        result = await runReplayCommand(parsed);
        break;
      default:
        result = await runHelpCommand(parsed);
        break;
    }

    return result.exitCode;
  } catch (error) {
    const formatted = formatError(error, false);
    console.error(formatted);
    return 1;
  }
}

export default runCli;

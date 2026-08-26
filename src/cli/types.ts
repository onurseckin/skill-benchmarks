import type { ReportFilter } from "../reporting/report-cohorts.js";
import type { CliCommandName, CliNormalizedValue } from "./grammar/types.js";

export type CliOutputFormat = "console" | "json" | "markdown" | "html";

export interface BenchmarkRunOptions {
  readonly scenarioIds: readonly string[];
  readonly skillIds: readonly string[];
  readonly modelIds: readonly string[];
  readonly providerId?: string;
  readonly category?: string;
  readonly concurrency?: number;
  readonly repetitions?: number;
  readonly temperature?: number;
  readonly thinking?: "none" | "low" | "medium" | "high" | "max";
  readonly reasoning?: "low" | "medium" | "high";
  readonly thinkingBudget?: number;
  readonly matrixThinking?: readonly ("none" | "low" | "medium" | "high" | "max")[];
  readonly dryRun?: boolean;
  readonly live?: boolean;
  readonly mock?: boolean;
  readonly outputDir?: string;
  readonly timeoutSeconds?: number;
  readonly maxTurns?: number;
  readonly maxCostUSD?: number;
  readonly dbPath?: string;
}

export interface ArenaCliOptions {
  readonly scenarioIds: readonly string[];
  readonly skillId?: string;
  readonly arenaModels: readonly string[];
  readonly dryRun?: boolean;
  readonly live?: boolean;
  readonly mock?: boolean;
  readonly outputDir?: string;
  readonly outputPath?: string;
}

export interface TournamentOptions {
  readonly scenarioIds: readonly string[];
  readonly skillIds: readonly string[];
  readonly modelIds: readonly string[];
  readonly tournamentMode?: "round-robin" | "swiss";
  readonly rounds?: number;
  readonly dryRun?: boolean;
  readonly live?: boolean;
  readonly mock?: boolean;
  readonly outputDir?: string;
  readonly outputPath?: string;
}

export interface ReportOptions extends ReportFilter {
  readonly format?: CliOutputFormat;
  readonly outputPath?: string;
  readonly dbPath?: string;
  readonly title?: string;
  readonly includeCostEfficiency?: boolean;
  readonly exportCard?: "svg" | "html";
  readonly cardOutputPath?: string;
}

export interface ListOptions {
  readonly target: "scenarios" | "skills" | "all";
}

export interface ReplayCliOptions {
  readonly target?: string;
  readonly runId?: string;
  readonly format?: "tui" | "html" | "json";
  readonly outputPath?: string;
  readonly speed?: number;
  readonly dbPath?: string;
  readonly outputDir?: string;
}

export interface CliParsedArgs {
  readonly command: CliCommandName;
  readonly helpRequested: boolean;
  readonly rawArgs: readonly string[];
  readonly flags: Readonly<Record<string, CliNormalizedValue>>;
  readonly positionals: readonly string[];
  readonly benchmarkOptions?: BenchmarkRunOptions;
  readonly arenaOptions?: ArenaCliOptions;
  readonly tournamentOptions?: TournamentOptions;
  readonly reportOptions?: ReportOptions;
  readonly listOptions?: ListOptions;
  readonly replayOptions?: ReplayCliOptions;
}

export interface CliCommandResult {
  readonly success: boolean;
  readonly exitCode: number;
  readonly data?: unknown;
  readonly durationMs: number;
}

export interface CliOutput {
  stdout(text: string): void;
  stderr(text: string): void;
}

export type CliCommandHandler = (
  args: CliParsedArgs,
  output: CliOutput,
) => Promise<CliCommandResult>;

export type { CliCommandName } from "./grammar/types.js";

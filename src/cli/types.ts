import type { ReportFilter } from "../reporting/report-cohorts.js";

export type CliCommandName =
  | "run"
  | "bench"
  | "arena"
  | "tournament"
  | "report"
  | "sync"
  | "list"
  | "replay"
  | "help"
  | "version";

export type CliOutputFormat = "console" | "json" | "markdown" | "html";

export type BenchmarkExecutionMode = "single" | "matrix";

export interface BenchmarkRunOptions {
  readonly scenarioIds: readonly string[];
  readonly skillIds: readonly string[];
  readonly modelIds: readonly string[];
  readonly providerId?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
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
  readonly outputFormat?: CliOutputFormat;
  readonly outputPath?: string;
  readonly verbose?: boolean;
  readonly judgeModelId?: string;
  readonly skipJudge?: boolean;
  readonly cleanSandbox?: boolean;
  readonly exportCard?: "svg" | "html";
  readonly cardOutputPath?: string;
}

export interface TournamentOptions {
  readonly scenarioIds: readonly string[];
  readonly skillIds: readonly string[];
  readonly modelIds?: readonly string[];
  readonly tournamentMode?: "round-robin" | "swiss";
  readonly rounds?: number;
  readonly dryRun?: boolean;
  readonly live?: boolean;
  readonly mock?: boolean;
  readonly outputDir?: string;
  readonly dbPath?: string;
  readonly outputPath?: string;
  readonly maxMatches?: number;
}

export interface ReportOptions extends ReportFilter {
  readonly format?: CliOutputFormat;
  readonly outputPath?: string;
  readonly dbPath?: string;
  readonly title?: string;
  readonly includeTrends?: boolean;
  readonly includeCostEfficiency?: boolean;
  readonly exportCard?: "svg" | "html";
  readonly cardOutputPath?: string;
}

export interface SyncOptions {
  readonly catalogPath?: string;
  readonly targetDir?: string;
  readonly category?: string;
  readonly force?: boolean;
  readonly verifyOnly?: boolean;
  readonly verbose?: boolean;
}

export interface ListOptions {
  readonly target: "scenarios" | "skills" | "models" | "all";
  readonly category?: string;
  readonly tag?: string;
  readonly format?: CliOutputFormat;
  readonly catalogPath?: string;
}

export interface ReplayCliOptions {
  readonly target?: string;
  readonly runId?: string;
  readonly format?: "tui" | "html" | "json";
  readonly outputPath?: string;
  readonly speed?: number;
  readonly dbPath?: string;
  readonly outputDir?: string;
  readonly verbose?: boolean;
}

export interface ArenaCliOptions {
  readonly scenarioIds?: readonly string[];
  readonly skillId?: string;
  readonly arenaModels?: readonly string[];
  readonly dryRun?: boolean;
  readonly live?: boolean;
  readonly mock?: boolean;
  readonly outputDir?: string;
  readonly outputPath?: string;
  readonly dbPath?: string;
}

export interface CliParsedArgs {
  readonly command: CliCommandName;
  readonly rawArgs: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean | number | readonly string[]>>;
  readonly positionals: readonly string[];
  readonly benchmarkOptions?: BenchmarkRunOptions;
  readonly arenaOptions?: ArenaCliOptions;
  readonly tournamentOptions?: TournamentOptions;
  readonly reportOptions?: ReportOptions;
  readonly syncOptions?: SyncOptions;
  readonly listOptions?: ListOptions;
  readonly replayOptions?: ReplayCliOptions;
}

export interface CliCommandResult {
  readonly success: boolean;
  readonly exitCode: number;
  readonly message?: string;
  readonly data?: unknown;
  readonly durationMs: number;
}

export interface TableColumn<T> {
  readonly key: keyof T | string;
  readonly header: string;
  readonly align?: "left" | "center" | "right";
  readonly width?: number;
  readonly formatter?: (value: unknown, row: T) => string;
}

export interface MetricCard {
  readonly title: string;
  readonly value: string | number;
  readonly change?: string;
  readonly status?: "success" | "warning" | "error" | "info" | "neutral";
  readonly subtitle?: string;
}

export interface ProgressBarOptions {
  readonly total: number;
  readonly current: number;
  readonly width?: number;
  readonly label?: string;
  readonly statusText?: string;
}

export type CliFlagValueType = "string" | "boolean" | "number" | "array";

export interface CliFlagDefinition {
  readonly name: string;
  readonly alias?: string;
  readonly type: CliFlagValueType;
  readonly description: string;
  readonly defaultValue?: string | boolean | number;
  readonly choices?: readonly string[];
}

export interface CliCommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly usage: string;
  readonly aliases?: readonly string[];
  readonly flags: readonly CliFlagDefinition[];
}

export type CliCommandHandler = (args: CliParsedArgs) => Promise<CliCommandResult>;

export type ProgressCallback = (current: number, total: number, statusText?: string) => void;

export type StatusBadgeStatus =
  | "success"
  | "error"
  | "warning"
  | "info"
  | "running"
  | "skipped"
  | "neutral";

export interface TableRenderOptions<T> {
  readonly columns: readonly TableColumn<T>[];
  readonly data: readonly T[];
  readonly title?: string;
  readonly maxColumnWidth?: number;
  readonly showBorders?: boolean;
}

export type CliCommandName =
  | "run"
  | "bench"
  | "tournament"
  | "report"
  | "sync"
  | "list"
  | "replay"
  | "fuzz"
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
}

export interface TournamentOptions {
  readonly scenarioIds: readonly string[];
  readonly skillIds: readonly string[];
  readonly modelIds?: readonly string[];
  readonly judgeModelId?: string;
  readonly judgeProviderId?: string;
  readonly kFactor?: number;
  readonly initialRating?: number;
  readonly dbPath?: string;
  readonly outputFormat?: CliOutputFormat;
  readonly outputPath?: string;
  readonly verbose?: boolean;
  readonly maxMatches?: number;
}

export interface ReportOptions {
  readonly format?: CliOutputFormat;
  readonly outputPath?: string;
  readonly dbPath?: string;
  readonly category?: string;
  readonly skillId?: string;
  readonly modelId?: string;
  readonly controlSkillId?: string;
  readonly title?: string;
  readonly includeTrends?: boolean;
  readonly includeCostEfficiency?: boolean;
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
  readonly filePath?: string;
  readonly format?: "tui" | "html" | "json";
  readonly outputPath?: string;
  readonly speed?: number;
  readonly dbPath?: string;
  readonly web?: boolean;
  readonly live?: boolean;
  readonly verbose?: boolean;
}

export interface FuzzCliOptions {
  readonly scenarioIds?: readonly string[];
  readonly skillIds?: readonly string[];
  readonly modelIds?: readonly string[];
  readonly strategies?: readonly string[];
  readonly severities?: readonly string[];
  readonly mutationsPerScenario?: number;
  readonly concurrency?: number;
  readonly seed?: number;
  readonly outputFormat?: CliOutputFormat;
  readonly outputPath?: string;
  readonly verbose?: boolean;
}

export interface CliParsedArgs {
  readonly command: CliCommandName;
  readonly rawArgs: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean | number | readonly string[]>>;
  readonly positionals: readonly string[];
  readonly benchmarkOptions?: BenchmarkRunOptions;
  readonly tournamentOptions?: TournamentOptions;
  readonly reportOptions?: ReportOptions;
  readonly syncOptions?: SyncOptions;
  readonly listOptions?: ListOptions;
  readonly replayOptions?: ReplayCliOptions;
  readonly fuzzOptions?: FuzzCliOptions;
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

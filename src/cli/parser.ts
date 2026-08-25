import type { CliCommandName, CliOutputFormat, BenchmarkRunOptions, TournamentOptions, SyncOptions, ListOptions, ReplayCliOptions, ArenaCliOptions, CliParsedArgs } from "./types.js";
import { getReplayHelpText } from "./replay-help.js";
import { parseReportOptions } from "./report-options.js";
type FlagValueKind = "string" | "boolean" | "number" | "array";
interface FlagSpec { readonly canonical: string; readonly kind: FlagValueKind; readonly aliases: readonly string[]; }
const SPECS: readonly (readonly [string, FlagValueKind, readonly string[]])[] = [
  ["scenario", "array", ["s", "scenario", "scenarios"]], ["skill", "array", ["k", "skill", "skills"]],
  ["model", "array", ["m", "model", "models"]], ["provider", "array", ["p", "provider"]],
  ["category", "array", ["c", "category"]], ["tag", "array", ["t", "tag", "tags"]],
  ["concurrency", "number", ["j", "concurrency"]], ["repetitions", "number", ["r", "repeats", "repetitions"]],
  ["temperature", "number", ["temperature"]], ["timeoutSeconds", "number", ["timeout", "timeout-seconds", "timeoutSeconds"]],
  ["maxTurns", "number", ["max-turns", "maxTurns"]], ["maxCostUSD", "number", ["max-cost", "maxCost", "max-cost-usd", "maxCostUSD"]],
  ["dbPath", "string", ["db", "database", "db-path", "dbPath"]], ["format", "string", ["f", "format"]],
  ["outputPath", "string", ["o", "output", "out", "output-path", "outputPath"]], ["verbose", "boolean", ["v", "verbose"]],
  ["outputDir", "string", ["output-dir", "outputDir"]],
  ["judgeModelId", "string", ["judge-model", "judgeModel", "judge-model-id", "judgeModelId"]],
  ["skipJudge", "boolean", ["skip-judge", "skipJudge"]], ["cleanSandbox", "boolean", ["clean-sandbox", "cleanSandbox"]],
  ["maxMatches", "number", ["max-matches", "maxMatches"]], ["controlSkillId", "string", ["control-skill", "controlSkill", "control-skill-id", "controlSkillId"]],
  ["title", "string", ["title"]], ["includeTrends", "boolean", ["include-trends", "includeTrends"]],
  ["includeCostEfficiency", "boolean", ["include-cost", "includeCost", "include-cost-efficiency", "includeCostEfficiency"]],
  ["catalogPath", "string", ["catalog", "catalog-path", "catalogPath"]], ["targetDir", "string", ["target-dir", "targetDir"]],
  ["force", "boolean", ["force"]], ["verifyOnly", "boolean", ["verify-only", "verifyOnly"]],
  ["help", "boolean", ["h", "help"]], ["version", "boolean", ["version"]],
  ["runId", "string", ["run-id", "runId"]], ["speed", "number", ["speed"]],
  ["live", "boolean", ["live"]],
  ["thinking", "string", ["thinking", "think", "thinking-level", "thinkingLevel"]],
  ["reasoning", "string", ["reasoning", "reasoning-effort", "reasoningEffort"]],
  ["thinkingBudget", "number", ["thinking-budget", "thinkingBudget", "budget-tokens", "budgetTokens"]],
  ["matrixThinking", "array", ["matrix-thinking", "matrixThinking", "thinking-matrix", "thinkingMatrix"]],
  ["arena", "array", ["arena", "arena-models", "arenaModels"]],
  ["tournamentMode", "string", ["tournament-mode", "tournamentMode", "mode"]],
  ["rounds", "number", ["rounds", "num-rounds", "numRounds"]],
  ["dryRun", "boolean", ["dry-run", "dryRun"]], ["mock", "boolean", ["mock"]],
  ["exportCard", "string", ["export-card", "exportCard", "card", "report-card", "reportCard"]],
  ["cardOutputPath", "string", ["card-output", "cardOutputPath", "card-out", "cardOut"]],
  ["status", "array", ["status"]], ["executionMode", "array", ["execution-mode", "executionMode"]],
  ["simulated", "string", ["simulated"]], ["authority", "string", ["authority"]],
  ["cohort", "array", ["cohort"]], ["eligibility", "array", ["eligibility"]],
  ["evaluationStatus", "array", ["evaluation-status", "evaluationStatus"]],
  ["evidenceStatus", "array", ["evidence-status", "evidenceStatus"]],
  ["fromDate", "string", ["from-date", "fromDate"]], ["toDate", "string", ["to-date", "toDate"]],
];
const FLAG_MAP = new Map<string, FlagSpec>();
for (const [canonical, kind, aliases] of SPECS) {
  const spec = { canonical, kind, aliases };
  for (const alias of aliases) { FLAG_MAP.set(alias, spec); FLAG_MAP.set(alias.toLowerCase(), spec); }
}
const KNOWN_COMMANDS = new Set<CliCommandName>([
  "run", "bench", "arena", "tournament", "report", "sync", "list", "replay", "help", "version",
]);
function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["true", "1", "yes"].includes(v.trim().toLowerCase());
  return Boolean(v);
}
function toOptionalBool(v: unknown): boolean | undefined {
  return v === undefined ? undefined : toBool(v);
}
function toNum(v: unknown): number | undefined {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") { const n = Number(v.trim()); return Number.isNaN(n) ? undefined : n; }
  return undefined;
}
function toStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}
function toArr(v: unknown): readonly string[] {
  if (Array.isArray(v)) return v.flatMap((item) => (typeof item === "string" ? item.split(",").map((s) => s.trim()).filter(Boolean) : []));
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}
function assignFlag(flags: Record<string, string | boolean | number | string[]>, rawKey: string, val: string | boolean): void {
  const isNo = rawKey.startsWith("no-");
  const baseKey = isNo ? rawKey.slice(3) : rawKey;
  const spec = FLAG_MAP.get(baseKey.toLowerCase());
  const parsed = isNo ? false : typeof val === "string" && spec?.kind === "boolean" ? toBool(val) : typeof val === "string" && spec?.kind === "number" ? (toNum(val) ?? val) : val;
  const key = spec?.canonical ?? rawKey;
  if (spec?.kind === "array") {
    const parts = String(parsed).split(",").map((s) => s.trim()).filter(Boolean);
    const existing = flags[key];
    const arr = Array.isArray(existing) ? [...existing, ...parts] : [...parts];
    flags[key] = arr;
    for (const a of spec.aliases) flags[a] = arr;
  } else {
    flags[key] = parsed;
    if (spec) for (const a of spec.aliases) flags[a] = parsed;
    else flags[rawKey] = parsed;
  }
}
function parseToken(token: string): { key: string; value?: string } {
  if (token.startsWith("--") || token.startsWith("-")) {
    const prefixLen = token.startsWith("--") ? 2 : 1;
    const eqIdx = token.indexOf("=");
    if (eqIdx !== -1) return { key: token.slice(prefixLen, eqIdx), value: token.slice(eqIdx + 1) };
    return { key: token.slice(prefixLen) };
  }
  return { key: token };
}

export function parseCliArgs(argv: readonly string[]): CliParsedArgs {
  const flags: Record<string, string | boolean | number | string[]> = {};
  const positionals: string[] = [];
  let command: CliCommandName = "help";
  let foundCommand = false;
  let i = 0;

  while (i < argv.length) {
    const token = argv[i];
    if (!token) { i++; continue; }
    if (token === "--") { positionals.push(...argv.slice(i + 1)); break; }
    if (token.startsWith("-")) {
      const { key, value } = parseToken(token);
      const spec = FLAG_MAP.get(key.toLowerCase());
      if (value !== undefined) {
        assignFlag(flags, key, value);
      } else if (spec?.kind === "boolean") {
        assignFlag(flags, key, true);
      } else if (i + 1 < argv.length && !argv[i + 1]?.startsWith("-")) {
        assignFlag(flags, key, argv[i + 1] ?? "");
        i++;
      } else {
        assignFlag(flags, key, true);
      }
    } else if (!foundCommand) {
      const candidate = token.toLowerCase() as CliCommandName;
      if (KNOWN_COMMANDS.has(candidate)) { command = candidate; foundCommand = true; }
      else throw new TypeError("Argument error: unknown command");
    } else {
      positionals.push(token);
    }
    i++;
  }

  if (!foundCommand && toArr(flags["arena"]).length > 0) {
    throw new TypeError("Argument error: arena requires the arena command");
  }
  if (Boolean(flags["help"]) && command !== "version") {
    if (foundCommand && command !== "help") positionals.unshift(command);
    command = "help";
  }
  if (Boolean(flags["version"])) command = "version";
  if (command === "help" && positionals[0] !== undefined
    && !KNOWN_COMMANDS.has(positionals[0].toLowerCase() as CliCommandName)) {
    throw new TypeError("Argument error: unknown command");
  }
  if ((command === "run" || command === "bench") && toArr(flags["arena"]).length > 0) {
    throw new TypeError("Argument error: arena requires the arena command");
  }
  if ((command === "arena" || command === "tournament") && hasRemovedCompetitionFlag(argv)) {
    throw new TypeError("Argument error: ranked competition options are unavailable");
  }

  const benchmarkOptions: BenchmarkRunOptions = {
    scenarioIds: toArr(flags["scenario"]).concat(positionals), skillIds: toArr(flags["skill"]),
    modelIds: toArr(flags["model"]), providerId: toArr(flags["provider"]).slice(-1)[0],
    category: toArr(flags["category"]).slice(-1)[0], tags: toArr(flags["tag"]),
    concurrency: toNum(flags["concurrency"]), repetitions: toNum(flags["repetitions"]),
    temperature: toNum(flags["temperature"]),
    thinking: toStr(flags["thinking"]) as BenchmarkRunOptions["thinking"],
    reasoning: toStr(flags["reasoning"]) as BenchmarkRunOptions["reasoning"],
    thinkingBudget: toNum(flags["thinkingBudget"]),
    matrixThinking: toArr(flags["matrixThinking"]) as BenchmarkRunOptions["matrixThinking"],
    dryRun: toBool(flags["dryRun"]),
    live: toOptionalBool(flags["live"]),
    mock: toOptionalBool(flags["mock"]),
    outputDir: typeof flags["outputDir"] === "string" ? flags["outputDir"] : undefined,
    timeoutSeconds: toNum(flags["timeoutSeconds"]),
    maxTurns: toNum(flags["maxTurns"]), maxCostUSD: toNum(flags["maxCostUSD"]),
    dbPath: toStr(flags["dbPath"]), outputFormat: toStr(flags["format"]) as CliOutputFormat | undefined,
    outputPath: toStr(flags["outputPath"]), verbose: toBool(flags["verbose"]),
    judgeModelId: toStr(flags["judgeModelId"]), skipJudge: toBool(flags["skipJudge"]), cleanSandbox: toBool(flags["cleanSandbox"]),
    exportCard: toStr(flags["exportCard"]) as "svg" | "html" | undefined,
    cardOutputPath: toStr(flags["cardOutputPath"]),
  };

  const arenaArr = toArr(flags["arena"]);
  const arenaModels = arenaArr.length > 0 ? arenaArr : toArr(flags["model"]);
  const arenaOptions: ArenaCliOptions = {
    scenarioIds: toArr(flags["scenario"]).concat(positionals),
    skillId: toArr(flags["skill"])[0],
    arenaModels,
    dryRun: toBool(flags["dryRun"]),
    live: toOptionalBool(flags["live"]),
    mock: toOptionalBool(flags["mock"]),
    outputDir: toStr(flags["outputDir"]),
    outputPath: toStr(flags["outputPath"]),
    dbPath: toStr(flags["dbPath"]),
  };

  const tournamentOptions: TournamentOptions = {
    scenarioIds: toArr(flags["scenario"]).concat(positionals), skillIds: toArr(flags["skill"]),
    modelIds: toArr(flags["model"]), tournamentMode: toStr(flags["tournamentMode"]) as TournamentOptions["tournamentMode"],
    rounds: toNum(flags["rounds"]), dbPath: toStr(flags["dbPath"]),
    dryRun: toBool(flags["dryRun"]), live: toOptionalBool(flags["live"]), mock: toOptionalBool(flags["mock"]),
    outputDir: toStr(flags["outputDir"]),
    outputPath: toStr(flags["outputPath"]), maxMatches: toNum(flags["maxMatches"]),
  };

  const reportOptions = command === "report" ? parseReportOptions(flags, positionals, argv) : undefined;

  const syncOptions: SyncOptions = {
    catalogPath: toStr(flags["catalogPath"]), targetDir: toStr(flags["targetDir"]),
    category: toArr(flags["category"]).slice(-1)[0], force: toBool(flags["force"]),
    verifyOnly: toBool(flags["verifyOnly"]), verbose: toBool(flags["verbose"]),
  };

  const listOptions: ListOptions = {
    target: (positionals[0] as ListOptions["target"]) ?? "all", category: toArr(flags["category"]).slice(-1)[0],
    tag: toStr(flags["tag"]), format: toStr(flags["format"]) as CliOutputFormat | undefined, catalogPath: toStr(flags["catalogPath"]),
  };

  const replayOptions: ReplayCliOptions = {
    target: positionals[0], runId: toStr(flags["runId"]),
    format: toStr(flags["format"]) as "tui" | "html" | "json" | undefined,
    outputPath: toStr(flags["outputPath"]), speed: toNum(flags["speed"]),
    dbPath: toStr(flags["dbPath"]), outputDir: toStr(flags["outputDir"]), verbose: toBool(flags["verbose"]),
  };

  return {
    command, rawArgs: argv, flags: flags as Readonly<Record<string, string | boolean | number | readonly string[]>>, positionals,
    benchmarkOptions: command === "run" || command === "bench" ? benchmarkOptions : undefined,
    arenaOptions: command === "arena" ? arenaOptions : undefined,
    tournamentOptions: command === "tournament" ? tournamentOptions : undefined,
    reportOptions,
    syncOptions: command === "sync" ? syncOptions : undefined,
    listOptions: command === "list" ? listOptions : undefined,
    replayOptions: command === "replay" ? replayOptions : undefined,
  };
}

function hasRemovedCompetitionFlag(argv: readonly string[]): boolean {
  const removed = new Set([
    "judge-model", "judgemodel", "judge-model-id", "judgemodelid", "judge-provider", "judgeprovider",
    "judge-provider-id", "judgeproviderid", "k-factor", "kfactor", "initial-rating", "initialrating",
    "skip-judge", "skipjudge",
  ]);
  return argv.some((argument) => {
    if (!argument.startsWith("-")) return false;
    const rawKey = (argument.replace(/^-+/, "").split("=", 1)[0] ?? "").toLowerCase();
    const key = rawKey.startsWith("no-") ? rawKey.slice(3) : rawKey;
    return removed.has(key);
  });
}
export function getVersionText(): string { return "skill-benchmarks v0.1.0"; }

function formatCmd(usage: string, desc: string, opts: readonly (readonly [string, string])[], ex: readonly string[]): string {
  const optStr = opts.map(([o, d]) => `  ${o.padEnd(24)} ${d}`).join("\n");
  const exStr = ex.map((e) => `  ${e}`).join("\n");
  return `Usage:\n  ${usage}\n\nDescription:\n  ${desc}\n\nOptions:\n${optStr}\n\nExamples:\n${exStr}`;
}
const RUN_OPTS: readonly (readonly [string, string])[] = [
  ["-s, --scenario <ids>", "Scenario IDs"], ["-k, --skill <ids>", "Skill IDs to evaluate"],
  ["-m, --model <ids>", "Model IDs to benchmark"], ["-p, --provider <id>", "Model provider ID"],
  ["-c, --category <name>", "Scenario category filter"], ["-t, --tag <tags>", "Scenario tags filter"],
  ["-j, --concurrency <n>", "Parallel concurrency (default: 4)"], ["-r, --repeats <n>", "Repetitions (default: 1)"],
  ["--temperature <n>", "LLM temperature"], ["--timeout <sec>", "Scenario timeout in seconds"],
  ["--max-turns <n>", "Maximum agent interaction turns"], ["--max-cost <usd>", "Max cost in USD"],
  ["--judge-model <id>", "LLM judge model ID"], ["--skip-judge", "Skip LLM judge scoring"],
  ["--clean-sandbox", "Clean sandboxes after completion"], ["--db <path>", "SQLite database path"],
  ["--mock", "Use deterministic fake provider mode"], ["--live", "Use live provider mode and require credentials"],
  ["--output-dir <path>", "Benchmark runtime output root"],
  ["-f, --format <format>", "Output format: console, json, markdown, html"], ["-o, --output <path>", "Output file path"],
  ["-v, --verbose", "Enable verbose logs"], ["-h, --help", "Show help for run command"],
];
const ARENA_OPTS: readonly (readonly [string, string])[] = [
  ["-s, --scenario <ids>", "Scenario IDs for head-to-head match"],
  ["--arena <m1,m2>", "Two distinct admitted model IDs"],
  ["-k, --skill <id>", "Target skill ID to evaluate"],
  ["--dry-run", "Plan the admitted pairing without benchmark execution"],
  ["--mock", "Execute deterministic simulated candidate diagnostics"],
  ["--live", "Report comparison evidence unavailable without provider work"],
  ["--output-dir <path>", "Benchmark runtime output root"],
  ["--db <path>", "SQLite path for candidate execution evidence"],
  ["-o, --output <path>", "Output file path"],
  ["-h, --help", "Show help for arena command"],
];
const TOURNAMENT_OPTS: readonly (readonly [string, string])[] = [
  ["-s, --scenario <ids>", "Scenario IDs"], ["-k, --skill <ids>", "Skill IDs to compete"],
  ["-m, --model <ids>", "Model IDs for participants"], ["--tournament-mode <mode>", "Tournament mode: round-robin, swiss"],
  ["--rounds <n>", "Number of planned rounds"], ["--max-matches <n>", "Maximum planned pairings"],
  ["--dry-run", "Plan deterministic pairings without benchmark execution"], ["--mock", "Execute simulated candidate diagnostics"],
  ["--live", "Report comparison evidence unavailable without provider work"], ["--output-dir <path>", "Benchmark runtime output root"],
  ["--db <path>", "SQLite path for candidate execution evidence"],
  ["-o, --output <path>", "Output file path"], ["-h, --help", "Show help for tournament command"],
];
const REPORT_OPTS: readonly (readonly [string, string])[] = [
  ["-f, --format <format>", "Report format: console, json, markdown, html"], ["-o, --output <path>", "Destination report file path"],
  ["--db <path>", "Source SQLite database path"], ["-s, --scenario <ids>", "Filter by scenario IDs"],
  ["-c, --category <names>", "Filter by categories"], ["-k, --skill <ids>", "Filter by skill IDs"],
  ["-m, --model <ids>", "Filter by model IDs"], ["-p, --provider <ids>", "Filter by provider IDs"],
  ["--status <values>", "Filter by lifecycle statuses"], ["--execution-mode <values>", "Filter by fake or live execution"],
  ["--simulated <bool>", "Filter by exact simulation provenance"], ["--authority <value>", "Filter by eligible or diagnostic authority"],
  ["--cohort <values>", "Filter by benchmark cohorts"], ["--eligibility <values>", "Filter by eligibility statuses"],
  ["--evaluation-status <values>", "Filter by evaluation statuses"], ["--evidence-status <values>", "Filter by evidence statuses"],
  ["--from-date <timestamp>", "Inclusive earliest start timestamp"], ["--to-date <timestamp>", "Inclusive latest start timestamp"],
  ["--title <text>", "Custom report title"],
  ["--include-trends", "Include historical trend data"], ["--include-cost", "Include cost-efficiency metrics"],
  ["--export-card <format>", "Export one eligible skill card as svg or html"], ["--card-output <path>", "Report card output path"],
  ["-h, --help", "Show help for report command"],
];
const SYNC_OPTS: readonly (readonly [string, string])[] = [
  ["--catalog <path>", "Catalog source path or URL"], ["--target-dir <path>", "Target installation directory"],
  ["-c, --category <name>", "Sync specific category only"], ["--force", "Overwrite existing files"],
  ["--verify-only", "Verify catalog manifest without writing"], ["-v, --verbose", "Enable verbose sync output"],
  ["-h, --help", "Show help for sync command"],
];
const LIST_OPTS: readonly (readonly [string, string])[] = [
  ["-c, --category <name>", "Filter entities by category"], ["-t, --tag <tag>", "Filter scenarios by tag"],
  ["-f, --format <format>", "Output format: console, json, markdown, html"], ["--catalog <path>", "Custom catalog path"],
  ["-h, --help", "Show help for list command"],
];
export function getHelpText(command?: CliCommandName): string {
  if (command === "run" || command === "bench") {
    return formatCmd(
      "skill-bench run [options] [scenario-ids...]", "Execute benchmark evaluation runs across scenarios, skills, and models.",
      RUN_OPTS, ["skill-bench run -s git-worktrees -k tdd -m gpt-4o"]
    );
  }
  if (command === "arena") {
    return formatCmd(
      "skill-bench arena [options]", "Plan pairings or execute simulated unranked candidate diagnostics.",
      ARENA_OPTS, ["skill-bench arena --dry-run -s fullstack-refactor -k tdd --arena gpt-4o,claude-3-7-sonnet-20250219"]
    );
  }
  if (command === "tournament") {
    return formatCmd(
      "skill-bench tournament [options]", "Plan pairings or execute simulated unranked candidate diagnostics.",
      TOURNAMENT_OPTS, ["skill-bench tournament --dry-run -s fullstack-refactor -k tdd -m gpt-4o,claude-3-7-sonnet-20250219"]
    );
  }
  if (command === "report") {
    return formatCmd(
      "skill-bench report [options]", "Generate evidence-backed cohort and eligibility reports.",
      REPORT_OPTS, ["skill-bench report -f markdown -o summary.md", "skill-bench report -f html -o dashboard.html"]
    );
  }
  if (command === "sync") {
    return formatCmd(
      "skill-bench sync [options]", "Synchronize skills and scenarios from catalog repositories.",
      SYNC_OPTS, ["skill-bench sync", "skill-bench sync --force --catalog ./catalog"]
    );
  }
  if (command === "list") {
    return formatCmd(
      "skill-bench list [target] [options]", "List available benchmark scenarios, skills, and models.",
      LIST_OPTS, ["skill-bench list scenarios", "skill-bench list skills -c reasoning"]
    );
  }
  if (command === "replay") {
    return getReplayHelpText();
  }
  if (command === "version") {
    return "Usage:\n  skill-bench version\n\nDescription:\n  Display skill-benchmarks version information.";
  }
  return [
    "skill-benchmarks - Deterministic LLM Agent Skill Benchmarking Harness", "",
    "Usage:", "  skill-bench <command> [options]", "",
    "Commands:",
    "  run          Execute benchmark scenarios against skills and models",
    "  bench        Alias for run",
    "  arena        Plan or execute unranked candidate comparisons",
    "  tournament   Plan or execute unranked comparison schedules",
    "  report       Generate benchmark reports (console, json, markdown, html)",
    "  sync         Sync skills and scenarios from catalog repositories",
    "  list         List available scenarios, skills, and models",
    "  replay       Interactive TUI or web execution replay player",
    "  help         Display help for a command",
    "  version      Display version information", "",
    "Global Options:",
    "  -h, --help            Show help information",
    "  --version             Show version information",
    "  -v, --verbose         Enable verbose diagnostic output",
    "  -f, --format <format> Output format: console, json, markdown, html",
    "  -o, --output <path>   Output file path",
    "  --db <path>           SQLite database storage path", "",
    "Run 'skill-bench help <command>' or 'skill-bench <command> --help' for details.",
  ].join("\n");
}

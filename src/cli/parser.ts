import type {
  CliCommandName,
  CliOutputFormat,
  BenchmarkRunOptions,
  TournamentOptions,
  ReportOptions,
  SyncOptions,
  ListOptions,
  ReplayCliOptions,
  FuzzCliOptions,
  CliParsedArgs,
} from "./types.js";

type FlagValueKind = "string" | "boolean" | "number" | "array";
interface FlagSpec { readonly canonical: string; readonly kind: FlagValueKind; readonly aliases: readonly string[]; }

const SPECS: readonly (readonly [string, FlagValueKind, readonly string[]])[] = [
  ["scenario", "array", ["s", "scenario", "scenarios"]], ["skill", "array", ["k", "skill", "skills"]],
  ["model", "array", ["m", "model", "models"]], ["provider", "string", ["p", "provider"]],
  ["category", "string", ["c", "category"]], ["tag", "array", ["t", "tag", "tags"]],
  ["concurrency", "number", ["j", "concurrency"]], ["repetitions", "number", ["r", "repeats", "repetitions"]],
  ["temperature", "number", ["temperature"]], ["timeoutSeconds", "number", ["timeout", "timeout-seconds", "timeoutSeconds"]],
  ["maxTurns", "number", ["max-turns", "maxTurns"]], ["maxCostUSD", "number", ["max-cost", "maxCost", "max-cost-usd", "maxCostUSD"]],
  ["dbPath", "string", ["db", "database", "db-path", "dbPath"]], ["format", "string", ["f", "format"]],
  ["outputPath", "string", ["o", "output", "out", "output-path", "outputPath"]], ["verbose", "boolean", ["v", "verbose"]],
  ["judgeModelId", "string", ["judge-model", "judgeModel", "judge-model-id", "judgeModelId"]],
  ["judgeProviderId", "string", ["judge-provider", "judgeProvider", "judge-provider-id", "judgeProviderId"]],
  ["skipJudge", "boolean", ["skip-judge", "skipJudge"]], ["cleanSandbox", "boolean", ["clean-sandbox", "cleanSandbox"]],
  ["kFactor", "number", ["k-factor", "kFactor"]], ["initialRating", "number", ["initial-rating", "initialRating"]],
  ["maxMatches", "number", ["max-matches", "maxMatches"]], ["controlSkillId", "string", ["control-skill", "controlSkill", "control-skill-id", "controlSkillId"]],
  ["title", "string", ["title"]], ["includeTrends", "boolean", ["include-trends", "includeTrends"]],
  ["includeCostEfficiency", "boolean", ["include-cost", "includeCost", "include-cost-efficiency", "includeCostEfficiency"]],
  ["catalogPath", "string", ["catalog", "catalog-path", "catalogPath"]], ["targetDir", "string", ["target-dir", "targetDir"]],
  ["force", "boolean", ["force"]], ["verifyOnly", "boolean", ["verify-only", "verifyOnly"]],
  ["help", "boolean", ["h", "help"]], ["version", "boolean", ["version"]],
  ["target", "string", ["target"]], ["runId", "string", ["run-id", "runId"]], ["speed", "number", ["speed"]],
  ["web", "boolean", ["web"]], ["live", "boolean", ["live"]],
  ["strategies", "array", ["strategies", "strategy"]], ["severities", "array", ["severities", "severity"]],
  ["mutationsPerScenario", "number", ["mutations-per-scenario", "mutationsPerScenario", "mutations"]],
  ["seed", "number", ["seed"]],
  ["thinking", "string", ["thinking", "think", "thinking-level", "thinkingLevel"]],
  ["reasoning", "string", ["reasoning", "reasoning-effort", "reasoningEffort"]],
  ["thinkingBudget", "number", ["thinking-budget", "thinkingBudget", "budget-tokens", "budgetTokens"]],
  ["matrixThinking", "array", ["matrix-thinking", "matrixThinking", "thinking-matrix", "thinkingMatrix"]],
];

const FLAG_MAP = new Map<string, FlagSpec>();
for (const [canonical, kind, aliases] of SPECS) {
  const spec = { canonical, kind, aliases };
  for (const alias of aliases) { FLAG_MAP.set(alias, spec); FLAG_MAP.set(alias.toLowerCase(), spec); }
}

const KNOWN_COMMANDS = new Set<CliCommandName>([
  "run", "bench", "tournament", "report", "sync", "list", "replay", "fuzz", "help", "version",
]);

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["true", "1", "yes"].includes(v.trim().toLowerCase());
  return Boolean(v);
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
      else positionals.push(token);
    } else {
      positionals.push(token);
    }
    i++;
  }

  if (Boolean(flags["help"]) && command !== "version") command = "help";
  if (Boolean(flags["version"])) command = "version";

  const benchmarkOptions: BenchmarkRunOptions = {
    scenarioIds: toArr(flags["scenario"]).concat(positionals), skillIds: toArr(flags["skill"]),
    modelIds: toArr(flags["model"]), providerId: toStr(flags["provider"]),
    category: toStr(flags["category"]), tags: toArr(flags["tag"]),
    concurrency: toNum(flags["concurrency"]), repetitions: toNum(flags["repetitions"]),
    temperature: toNum(flags["temperature"]),
    thinking: toStr(flags["thinking"]) as BenchmarkRunOptions["thinking"],
    reasoning: toStr(flags["reasoning"]) as BenchmarkRunOptions["reasoning"],
    thinkingBudget: toNum(flags["thinkingBudget"]),
    matrixThinking: toArr(flags["matrixThinking"]) as BenchmarkRunOptions["matrixThinking"],
    timeoutSeconds: toNum(flags["timeoutSeconds"]),
    maxTurns: toNum(flags["maxTurns"]), maxCostUSD: toNum(flags["maxCostUSD"]),
    dbPath: toStr(flags["dbPath"]), outputFormat: toStr(flags["format"]) as CliOutputFormat | undefined,
    outputPath: toStr(flags["outputPath"]), verbose: toBool(flags["verbose"]),
    judgeModelId: toStr(flags["judgeModelId"]), skipJudge: toBool(flags["skipJudge"]), cleanSandbox: toBool(flags["cleanSandbox"]),
  };

  const tournamentOptions: TournamentOptions = {
    scenarioIds: toArr(flags["scenario"]).concat(positionals), skillIds: toArr(flags["skill"]),
    modelIds: toArr(flags["model"]), judgeModelId: toStr(flags["judgeModelId"]),
    judgeProviderId: toStr(flags["judgeProviderId"]), kFactor: toNum(flags["kFactor"]),
    initialRating: toNum(flags["initialRating"]), dbPath: toStr(flags["dbPath"]),
    outputFormat: toStr(flags["format"]) as CliOutputFormat | undefined,
    outputPath: toStr(flags["outputPath"]), verbose: toBool(flags["verbose"]), maxMatches: toNum(flags["maxMatches"]),
  };

  const reportOptions: ReportOptions = {
    format: toStr(flags["format"]) as CliOutputFormat | undefined, outputPath: toStr(flags["outputPath"]),
    dbPath: toStr(flags["dbPath"]), category: toStr(flags["category"]),
    skillId: toStr(flags["skill"]), modelId: toStr(flags["model"]),
    controlSkillId: toStr(flags["controlSkillId"]), title: toStr(flags["title"]),
    includeTrends: toBool(flags["includeTrends"]), includeCostEfficiency: toBool(flags["includeCostEfficiency"]),
  };

  const syncOptions: SyncOptions = {
    catalogPath: toStr(flags["catalogPath"]), targetDir: toStr(flags["targetDir"]),
    category: toStr(flags["category"]), force: toBool(flags["force"]),
    verifyOnly: toBool(flags["verifyOnly"]), verbose: toBool(flags["verbose"]),
  };

  const listOptions: ListOptions = {
    target: (positionals[0] as ListOptions["target"]) ?? "all", category: toStr(flags["category"]),
    tag: toStr(flags["tag"]), format: toStr(flags["format"]) as CliOutputFormat | undefined, catalogPath: toStr(flags["catalogPath"]),
  };

  const replayOptions: ReplayCliOptions = {
    target: toStr(flags["target"]) ?? positionals[0], runId: toStr(flags["runId"]),
    filePath: toStr(flags["outputPath"]) ?? toStr(flags["target"]), format: toStr(flags["format"]) as "tui" | "html" | "json" | undefined,
    outputPath: toStr(flags["outputPath"]), speed: toNum(flags["speed"]),
    dbPath: toStr(flags["dbPath"]), web: toBool(flags["web"]), live: toBool(flags["live"]), verbose: toBool(flags["verbose"]),
  };

  const fuzzOptions: FuzzCliOptions = {
    scenarioIds: toArr(flags["scenario"]).concat(positionals), skillIds: toArr(flags["skill"]),
    modelIds: toArr(flags["model"]), strategies: toArr(flags["strategies"]), severities: toArr(flags["severities"]),
    mutationsPerScenario: toNum(flags["mutationsPerScenario"]), concurrency: toNum(flags["concurrency"]),
    seed: toNum(flags["seed"]), outputFormat: toStr(flags["format"]) as CliOutputFormat | undefined,
    outputPath: toStr(flags["outputPath"]), verbose: toBool(flags["verbose"]),
  };

  return {
    command, rawArgs: argv, flags: flags as Readonly<Record<string, string | boolean | number | readonly string[]>>, positionals,
    benchmarkOptions: command === "run" || command === "bench" ? benchmarkOptions : undefined,
    tournamentOptions: command === "tournament" ? tournamentOptions : undefined,
    reportOptions: command === "report" ? reportOptions : undefined,
    syncOptions: command === "sync" ? syncOptions : undefined,
    listOptions: command === "list" ? listOptions : undefined,
    replayOptions: command === "replay" ? replayOptions : undefined,
    fuzzOptions: command === "fuzz" ? fuzzOptions : undefined,
  };
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
  ["-f, --format <format>", "Output format: console, json, markdown, html"], ["-o, --output <path>", "Output file path"],
  ["-v, --verbose", "Enable verbose logs"], ["-h, --help", "Show help for run command"],
];

const TOURNAMENT_OPTS: readonly (readonly [string, string])[] = [
  ["-s, --scenario <ids>", "Scenario IDs"], ["-k, --skill <ids>", "Skill IDs to compete"],
  ["-m, --model <ids>", "Model IDs for participants"], ["--judge-model <id>", "Judge model ID"],
  ["--judge-provider <id>", "Judge provider ID"], ["--k-factor <n>", "Elo K-factor (default: 32)"],
  ["--initial-rating <n>", "Initial rating (default: 1500)"], ["--max-matches <n>", "Max tournament matches"],
  ["--db <path>", "SQLite database path"], ["-f, --format <format>", "Output format: console, json, markdown, html"],
  ["-o, --output <path>", "Output file path"], ["-v, --verbose", "Enable verbose logs"], ["-h, --help", "Show help for tournament command"],
];

const REPORT_OPTS: readonly (readonly [string, string])[] = [
  ["-f, --format <format>", "Report format: console, json, markdown, html"], ["-o, --output <path>", "Destination report file path"],
  ["--db <path>", "Source SQLite database path"], ["-c, --category <name>", "Filter results by category"],
  ["-k, --skill <id>", "Filter results by skill ID"], ["-m, --model <id>", "Filter results by model ID"],
  ["--control-skill <id>", "Baseline control skill ID"], ["--title <text>", "Custom report title"],
  ["--include-trends", "Include historical trend data"], ["--include-cost", "Include cost-efficiency metrics"],
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

const FUZZ_OPTS: readonly (readonly [string, string])[] = [
  ["-s, --scenario <ids>", "Scenario IDs to fuzz"], ["-k, --skill <ids>", "Skill IDs under evaluation"],
  ["-m, --model <ids>", "Model IDs to test"], ["--strategies <strats>", "Mutation strategies (comma-separated)"],
  ["--severities <sevs>", "Mutation severities (low, medium, high, critical)"],
  ["--mutations <n>", "Mutated variants generated per scenario (default: 4)"],
  ["-j, --concurrency <n>", "Parallel execution concurrency (default: 4)"],
  ["--seed <n>", "PRNG seed for deterministic mutation (default: 42)"],
  ["-o, --output <path>", "Export path for markdown resilience report"],
  ["-v, --verbose", "Enable verbose fuzz event logging"], ["-h, --help", "Show help for fuzz command"],
];

export function getHelpText(command?: CliCommandName): string {
  if (command === "run" || command === "bench") {
    return formatCmd(
      "skill-bench run [options] [scenario-ids...]", "Execute benchmark evaluation runs across scenarios, skills, and models.",
      RUN_OPTS, ["skill-bench run -s git-workflow -k git-master -m gpt-4o", "skill-bench run -c coding -m gpt-4o -j 8"]
    );
  }
  if (command === "tournament") {
    return formatCmd(
      "skill-bench tournament [options] [scenario-ids...]", "Run pairwise Elo rating tournament matches between skills.",
      TOURNAMENT_OPTS, ["skill-bench tournament -s coding-refactor -k skill-v1,skill-v2"]
    );
  }
  if (command === "report") {
    return formatCmd(
      "skill-bench report [options]", "Generate benchmark analytics, comparison, and trend reports.",
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
  if (command === "fuzz") {
    return formatCmd(
      "skill-bench fuzz [options] [scenario-ids...]", "Run adversarial mutation fuzzing across benchmark scenarios.",
      FUZZ_OPTS, [
        "skill-bench fuzz -s git-worktrees --strategies prompt_injection,syntax_corruption",
        "skill-bench fuzz -s git-worktrees --severities low,medium,high,critical -o fuzz-report.md",
        "skill-bench fuzz -s git-worktrees --mutations 8 -j 4 --seed 1337",
      ]
    );
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
    "  tournament   Run pairwise Elo tournament between skills",
    "  report       Generate benchmark reports (console, json, markdown, html)",
    "  sync         Sync skills and scenarios from catalog repositories",
    "  list         List available scenarios, skills, and models",
    "  replay       Interactive TUI or web execution replay player",
    "  fuzz         Adversarial scenario mutation and fuzzing engine",
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

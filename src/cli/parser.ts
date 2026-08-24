import type {
  CliCommandName,
  CliOutputFormat,
  BenchmarkRunOptions,
  TournamentOptions,
  ReportOptions,
  SyncOptions,
  ListOptions,
  CliParsedArgs,
} from "./types";

type FlagValueKind = "string" | "boolean" | "number" | "array";

interface FlagSpec {
  readonly canonical: string;
  readonly kind: FlagValueKind;
  readonly aliases: readonly string[];
}

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
];

const FLAG_MAP = new Map<string, FlagSpec>();
for (const [canonical, kind, aliases] of SPECS) {
  const spec = { canonical, kind, aliases };
  for (const alias of aliases) {
    FLAG_MAP.set(alias, spec);
    FLAG_MAP.set(alias.toLowerCase(), spec);
  }
}

const KNOWN_COMMANDS = new Set<CliCommandName>([
  "run", "bench", "tournament", "report", "sync", "list", "help", "version",
]);

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["true", "1", "yes"].includes(v.trim().toLowerCase());
  return Boolean(v);
}

function toNum(v: unknown): number | undefined {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

function toStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function toArr(v: unknown): readonly string[] {
  if (Array.isArray(v)) {
    return v.flatMap((item) => (typeof item === "string" ? item.split(",").map((s) => s.trim()).filter(Boolean) : []));
  }
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
  const stripped = token.startsWith("--") ? token.slice(2) : token.slice(1);
  const eqIdx = stripped.indexOf("=");
  return eqIdx !== -1 ? { key: stripped.slice(0, eqIdx), value: stripped.slice(eqIdx + 1) } : { key: stripped };
}

export function parseCliArgs(rawArgs: readonly string[]): CliParsedArgs {
  const rawFlags: Record<string, string | boolean | number | string[]> = {};
  const positionals: string[] = [];

  let index = 0;
  while (index < rawArgs.length) {
    const arg = rawArgs[index];
    if (!arg) {
      index += 1;
      continue;
    }
    if (arg === "--") {
      positionals.push(...rawArgs.slice(index + 1));
      break;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      const { key, value } = parseToken(arg);
      const isBool = key.startsWith("no-") ? FLAG_MAP.get(key.slice(3))?.kind === "boolean" : FLAG_MAP.get(key)?.kind === "boolean";
      if (value !== undefined) {
        assignFlag(rawFlags, key, value);
        index += 1;
      } else if (isBool) {
        assignFlag(rawFlags, key, true);
        index += 1;
      } else {
        const next = rawArgs[index + 1];
        if (next !== undefined && !next.startsWith("-")) {
          assignFlag(rawFlags, key, next);
          index += 2;
        } else {
          assignFlag(rawFlags, key, true);
          index += 1;
        }
      }
    } else {
      positionals.push(arg);
      index += 1;
    }
  }

  let command: CliCommandName;
  let remainingPositionals: readonly string[];
  const firstPos = positionals[0]?.toLowerCase();
  if (firstPos && KNOWN_COMMANDS.has(firstPos as CliCommandName)) {
    command = firstPos as CliCommandName;
    remainingPositionals = positionals.slice(1);
  } else if (rawFlags["version"] === true) {
    command = "version";
    remainingPositionals = positionals;
  } else if (rawFlags["help"] === true || rawFlags["h"] === true) {
    command = "help";
    remainingPositionals = positionals;
  } else if (toArr(rawFlags["scenario"]).length > 0 || toArr(rawFlags["skill"]).length > 0 || toArr(rawFlags["model"]).length > 0) {
    command = "run";
    remainingPositionals = positionals;
  } else {
    command = "help";
    remainingPositionals = positionals;
  }

  const finalFlags: Record<string, string | boolean | number | readonly string[]> = {};
  for (const [k, v] of Object.entries(rawFlags)) {
    finalFlags[k] = Array.isArray(v) ? Object.freeze([...v]) : v;
  }
  const frozenFlags = Object.freeze(finalFlags);

  const parsedScenarios = toArr(rawFlags["scenario"]);
  const effectiveScenarios = parsedScenarios.length > 0 ? parsedScenarios : remainingPositionals;
  const skills = toArr(rawFlags["skill"]);
  const models = toArr(rawFlags["model"]);
  const tags = toArr(rawFlags["tag"]);
  const format = toStr(rawFlags["format"]);
  const outputFormat = format && ["console", "json", "markdown", "html"].includes(format) ? (format as CliOutputFormat) : undefined;
  const dbPath = toStr(rawFlags["dbPath"]);
  const outputPath = toStr(rawFlags["outputPath"]);
  const verbose = typeof rawFlags["verbose"] === "boolean" ? rawFlags["verbose"] : undefined;
  const targetCandidate = remainingPositionals[0]?.toLowerCase();
  const listTarget = targetCandidate && ["scenarios", "skills", "models", "all"].includes(targetCandidate) ? (targetCandidate as "scenarios" | "skills" | "models" | "all") : "all";

  const benchmarkOptions: BenchmarkRunOptions = {
    scenarioIds: effectiveScenarios,
    skillIds: skills,
    modelIds: models,
    providerId: toStr(rawFlags["provider"]),
    category: toStr(rawFlags["category"]),
    tags: tags.length > 0 ? tags : undefined,
    concurrency: toNum(rawFlags["concurrency"]),
    repetitions: toNum(rawFlags["repetitions"]),
    temperature: toNum(rawFlags["temperature"]),
    timeoutSeconds: toNum(rawFlags["timeoutSeconds"]),
    maxTurns: toNum(rawFlags["maxTurns"]),
    maxCostUSD: toNum(rawFlags["maxCostUSD"]),
    dbPath, outputFormat, outputPath, verbose,
    judgeModelId: toStr(rawFlags["judgeModelId"]),
    skipJudge: typeof rawFlags["skipJudge"] === "boolean" ? rawFlags["skipJudge"] : undefined,
    cleanSandbox: typeof rawFlags["cleanSandbox"] === "boolean" ? rawFlags["cleanSandbox"] : undefined,
  };

  const tournamentOptions: TournamentOptions = {
    scenarioIds: effectiveScenarios,
    skillIds: skills,
    modelIds: models.length > 0 ? models : undefined,
    judgeModelId: toStr(rawFlags["judgeModelId"]),
    judgeProviderId: toStr(rawFlags["judgeProviderId"]),
    kFactor: toNum(rawFlags["kFactor"]),
    initialRating: toNum(rawFlags["initialRating"]),
    dbPath, outputFormat, outputPath, verbose,
    maxMatches: toNum(rawFlags["maxMatches"]),
  };

  const reportOptions: ReportOptions = {
    format: outputFormat ?? "console",
    outputPath, dbPath,
    category: toStr(rawFlags["category"]),
    skillId: skills[0],
    modelId: models[0],
    controlSkillId: toStr(rawFlags["controlSkillId"]),
    title: toStr(rawFlags["title"]),
    includeTrends: typeof rawFlags["includeTrends"] === "boolean" ? rawFlags["includeTrends"] : undefined,
    includeCostEfficiency: typeof rawFlags["includeCostEfficiency"] === "boolean" ? rawFlags["includeCostEfficiency"] : undefined,
  };

  const syncOptions: SyncOptions = {
    catalogPath: toStr(rawFlags["catalogPath"]),
    targetDir: toStr(rawFlags["targetDir"]),
    category: toStr(rawFlags["category"]),
    force: typeof rawFlags["force"] === "boolean" ? rawFlags["force"] : undefined,
    verifyOnly: typeof rawFlags["verifyOnly"] === "boolean" ? rawFlags["verifyOnly"] : undefined,
    verbose,
  };

  const listOptions: ListOptions = {
    target: listTarget,
    category: toStr(rawFlags["category"]),
    tag: tags[0],
    format: outputFormat,
    catalogPath: toStr(rawFlags["catalogPath"]),
  };

  return {
    command,
    rawArgs,
    flags: frozenFlags,
    positionals: remainingPositionals,
    benchmarkOptions: command === "run" || command === "bench" ? benchmarkOptions : undefined,
    tournamentOptions: command === "tournament" ? tournamentOptions : undefined,
    reportOptions: command === "report" ? reportOptions : undefined,
    syncOptions: command === "sync" ? syncOptions : undefined,
    listOptions: command === "list" ? listOptions : undefined,
  };
}

export function getVersionText(): string {
  return "skill-benchmarks v0.1.0";
}

function formatCmd(usage: string, desc: string, opts: readonly (readonly [string, string])[], ex: readonly string[]): string {
  const optStr = opts.map(([o, d]) => `  ${o.padEnd(24)} ${d}`).join("\n");
  const exStr = ex.map((e) => `  ${e}`).join("\n");
  return `Usage:\n  ${usage}\n\nDescription:\n  ${desc}\n\nOptions:\n${optStr}\n\nExamples:\n${exStr}`;
}

const RUN_OPTS: readonly (readonly [string, string])[] = [
  ["-s, --scenario <ids>", "Scenario IDs (comma-separated/repeated)"], ["-k, --skill <ids>", "Skill IDs to evaluate"],
  ["-m, --model <ids>", "Model IDs to benchmark"], ["-p, --provider <id>", "Model provider ID"],
  ["-c, --category <name>", "Scenario category filter"], ["-t, --tag <tags>", "Scenario tags filter"],
  ["-j, --concurrency <n>", "Parallel concurrency (default: 4)"], ["-r, --repeats <n>", "Repetitions (default: 1)"],
  ["--temperature <n>", "LLM temperature"], ["--timeout <sec>", "Scenario timeout in seconds"],
  ["--max-turns <n>", "Maximum agent interaction turns"], ["--max-cost <usd>", "Max cost in USD"],
  ["--judge-model <id>", "LLM judge model ID"], ["--skip-judge", "Skip LLM judge scoring"],
  ["--clean-sandbox", "Clean sandboxes after completion"], ["--db <path>", "SQLite database path"],
  ["-f, --format <format>", "Output format: console, json, markdown, html"], ["-o, --output <path>", "Output file path"],
  ["-v, --verbose", "Enable verbose execution logs"], ["-h, --help", "Show help for run command"],
];

const TOURNAMENT_OPTS: readonly (readonly [string, string])[] = [
  ["-s, --scenario <ids>", "Scenario IDs"], ["-k, --skill <ids>", "Skill IDs to compete"],
  ["-m, --model <ids>", "Model IDs for participants"], ["--judge-model <id>", "Judge model ID for pairwise comparison"],
  ["--judge-provider <id>", "Judge provider ID"], ["--k-factor <n>", "Elo K-factor (default: 32)"],
  ["--initial-rating <n>", "Initial rating (default: 1500)"], ["--max-matches <n>", "Max tournament matches"],
  ["--db <path>", "SQLite database path"], ["-f, --format <format>", "Output format: console, json, markdown, html"],
  ["-o, --output <path>", "Output file path"], ["-v, --verbose", "Enable verbose logs"],
  ["-h, --help", "Show help for tournament command"],
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

export function getHelpText(command?: CliCommandName): string {
  if (command === "run" || command === "bench") {
    return formatCmd(
      "skill-bench run [options] [scenario-ids...]\n  skill-bench bench [options] [scenario-ids...]",
      "Execute benchmark evaluation runs across scenarios, skills, and models.",
      RUN_OPTS,
      [
        "skill-bench run -s git-workflow -k git-master -m gpt-4o",
        "skill-bench run -c coding -m gpt-4o,claude-3-5-sonnet -j 8",
        "skill-bench bench -s math-1,math-2 -k python-calc --skip-judge",
      ]
    );
  }
  if (command === "tournament") {
    return formatCmd(
      "skill-bench tournament [options] [scenario-ids...]",
      "Run pairwise Elo rating tournament matches between skills.",
      TOURNAMENT_OPTS,
      [
        "skill-bench tournament -s coding-refactor -k skill-v1,skill-v2,skill-v3",
        "skill-bench tournament -s task-1 -k agent-a,agent-b --judge-model gpt-4o",
      ]
    );
  }
  if (command === "report") {
    return formatCmd(
      "skill-bench report [options]",
      "Generate benchmark analytics, comparison, and trend reports.",
      REPORT_OPTS,
      [
        "skill-bench report -f markdown -o benchmark-summary.md",
        "skill-bench report -f html -o dashboard.html --include-trends --include-cost",
        'skill-bench report --control-skill baseline-skill --title "Release v2.0"',
      ]
    );
  }
  if (command === "sync") {
    return formatCmd(
      "skill-bench sync [options]",
      "Synchronize skills and scenarios from catalog repositories.",
      SYNC_OPTS,
      ["skill-bench sync", "skill-bench sync --force --catalog ./skills-catalog", "skill-bench sync --verify-only"]
    );
  }
  if (command === "list") {
    return formatCmd(
      "skill-bench list [target] [options]",
      "List available benchmark scenarios, skills, and models.\n\nArguments:\n  target                   Entity type: scenarios, skills, models, all (default: all)",
      LIST_OPTS,
      ["skill-bench list scenarios", "skill-bench list skills -c reasoning", "skill-bench list all -f json"]
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

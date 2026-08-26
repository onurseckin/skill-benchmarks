import type {
  CliCommandName,
  CliCommandSpecification,
  CliFlagSpecification,
  CliFlagValueKind,
} from "./types.js";
import { arrayFlag, booleanFlag, command, flag, numberFlag, stringFlag } from "./builders.js";

export const thinkingLevelChoices = Object.freeze([
  "none",
  "low",
  "medium",
  "high",
  "max",
] as const);
export const reasoningLevelChoices = Object.freeze(["low", "medium", "high"] as const);
export const tournamentModeChoices = Object.freeze(["round-robin", "swiss"] as const);
export const reportFormatChoices = Object.freeze(["console", "json", "markdown", "html"] as const);
export const reportCardFormatChoices = Object.freeze(["svg", "html"] as const);
export const replayFormatChoices = Object.freeze(["tui", "html", "json"] as const);
export const listTargetChoices = Object.freeze(["scenarios", "skills", "all"] as const);
const providerIds = Object.freeze(["anthropic", "openai", "google", "ollama", "custom"]);
const runFlags = Object.freeze([
  arrayFlag("scenarioIds", "scenario", "Scenario IDs", ["s"]),
  arrayFlag("skillIds", "skill", "Skill IDs", ["k"]),
  arrayFlag("modelIds", "model", "Model IDs", ["m"]),
  flag({
    key: "providerId",
    name: "provider",
    aliases: ["p"],
    kind: "string",
    valueName: "id",
    description: "Model provider ID",
    choices: providerIds,
  }),
  flag({
    key: "category",
    name: "category",
    aliases: ["c"],
    kind: "string",
    valueName: "name",
    description: "Scenario category",
  }),
  numberFlag(
    "concurrency",
    "concurrency",
    "Parallel concurrency",
    { integer: true, minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    ["j"],
  ),
  numberFlag(
    "repetitions",
    "repetitions",
    "Matrix repetitions",
    { integer: true, minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    ["r"],
  ),
  numberFlag("temperature", "temperature", "Model temperature", {}),
  stringFlag("thinking", "thinking", "Thinking level", thinkingLevelChoices),
  stringFlag("reasoning", "reasoning", "Reasoning effort", reasoningLevelChoices),
  numberFlag("thinkingBudget", "thinking-budget", "Thinking token budget", {
    integer: true,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  }),
  arrayFlag("matrixThinking", "matrix-thinking", "Thinking-level matrix", [], thinkingLevelChoices),
  numberFlag("timeoutSeconds", "timeout", "Positive timeout with millisecond precision", {
    exclusiveMinimum: 0,
    safeIntegerScale: 1000,
  }),
  numberFlag("maxTurns", "max-turns", "Maximum interaction turns", {
    integer: true,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  }),
  numberFlag("maxCostUSD", "max-cost", "Maximum cost in USD", { minimum: 0 }),
  booleanFlag("mock", "mock", "Use deterministic fake execution"),
  booleanFlag("live", "live", "Use live provider execution"),
  booleanFlag("dryRun", "dry-run", "Plan without executing cells"),
  stringFlag("outputDir", "output-dir", "Benchmark runtime output root"),
  stringFlag("dbPath", "db", "SQLite evidence database path"),
]);
const competitionModes = Object.freeze([
  booleanFlag("dryRun", "dry-run", "Plan without candidate execution"),
  booleanFlag("mock", "mock", "Use deterministic fake execution"),
  booleanFlag("live", "live", "Use live provider execution"),
  stringFlag("outputDir", "output-dir", "Benchmark runtime output root"),
  stringFlag("outputPath", "output", "Diagnostic JSON output path"),
]);
const reportFlags = Object.freeze([
  stringFlag("dbPath", "db", "Existing SQLite evidence database"),
  stringFlag("format", "format", "Report format", reportFormatChoices),
  stringFlag("outputPath", "output", "Report output path"),
  arrayFlag("scenarioIds", "scenario", "Scenario filters"),
  arrayFlag("categories", "category", "Category filters"),
  arrayFlag("skillIds", "skill", "Skill filters"),
  arrayFlag("modelIds", "model", "Model filters"),
  arrayFlag("providerIds", "provider", "Provider filters"),
  arrayFlag(
    "statuses",
    "status",
    "Terminal status filters",
    [],
    ["completed", "failed", "timed_out", "aborted"],
  ),
  arrayFlag("executionModes", "execution-mode", "Execution-mode filters", [], ["fake", "live"]),
  stringFlag("simulated", "simulated", "Simulation provenance", ["true", "false"]),
  stringFlag("authority", "authority", "Evidence authority", ["eligible", "diagnostic"]),
  arrayFlag(
    "benchmarkCohorts",
    "cohort",
    "Benchmark cohort filters",
    [],
    ["eligible", "validation", "operational"],
  ),
  arrayFlag(
    "eligibilityStatuses",
    "eligibility",
    "Eligibility filters",
    [],
    ["eligible", "ineligible", "unknown"],
  ),
  arrayFlag(
    "evaluationStatuses",
    "evaluation-status",
    "Evaluation status filters",
    [],
    ["not_requested", "not_evaluated", "evaluated", "invalid"],
  ),
  arrayFlag(
    "evidenceStatuses",
    "evidence-status",
    "Evidence status filters",
    [],
    ["unavailable", "collecting", "complete", "invalid"],
  ),
  stringFlag("fromDate", "from-date", "Inclusive earliest start timestamp"),
  stringFlag("toDate", "to-date", "Inclusive latest start timestamp"),
  stringFlag("title", "title", "Report title"),
  booleanFlag("includeCostEfficiency", "include-cost", "Include verified eligible cost facts"),
  stringFlag("exportCard", "export-card", "Report card format", reportCardFormatChoices),
  stringFlag("cardOutputPath", "card-output", "Report card output path"),
]);

export const commandSpecifications: readonly CliCommandSpecification[] = Object.freeze([
  command(
    "run",
    "Execute admitted benchmark scenarios.",
    "skill-benchmarks run [options] [scenario-ids...]",
    runFlags,
    [{ key: "skillIds", code: "skill_unresolved" }],
    ["run"],
    ["skill-benchmarks run --mock --scenario git-worktrees --skill tdd --model gpt-4o"],
    { name: "scenario-id", minimum: 0 },
  ),
  command(
    "arena",
    "Plan or run two unranked candidate diagnostics.",
    "skill-benchmarks arena [options]",
    [
      arrayFlag("scenarioIds", "scenario", "One scenario ID"),
      arrayFlag("skillIds", "skill", "One skill ID"),
      arrayFlag("arenaModels", "arena", "Two model IDs"),
      ...competitionModes,
    ],
    [
      { key: "scenarioIds", code: "scenario_unresolved" },
      { key: "skillIds", code: "skill_unresolved" },
      { key: "arenaModels", code: "empty_matrix" },
    ],
    ["arena"],
    [
      "skill-benchmarks arena --dry-run --scenario git-worktrees --skill tdd --arena gpt-4o,claude-3-7-sonnet-20250219",
    ],
  ),
  command(
    "tournament",
    "Plan or run unranked candidate schedules.",
    "skill-benchmarks tournament [options]",
    [
      arrayFlag("scenarioIds", "scenario", "Scenario IDs"),
      arrayFlag("skillIds", "skill", "One skill ID"),
      arrayFlag("modelIds", "model", "Participant model IDs"),
      stringFlag(
        "tournamentMode",
        "tournament-mode",
        "Tournament planning mode",
        tournamentModeChoices,
      ),
      numberFlag("rounds", "rounds", "Planned round count", {
        integer: true,
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
      }),
      ...competitionModes,
    ],
    [
      { key: "scenarioIds", code: "scenario_unresolved" },
      { key: "skillIds", code: "skill_unresolved" },
      { key: "modelIds", code: "empty_matrix" },
    ],
    ["tournament"],
    [
      "skill-benchmarks tournament --dry-run --scenario git-worktrees --skill tdd --model gpt-4o,claude-3-7-sonnet-20250219",
    ],
  ),
  command(
    "report",
    "Generate evidence-backed cohort reports.",
    "skill-benchmarks report [options]",
    reportFlags,
    [{ key: "dbPath", code: "report_database_unavailable" }],
    ["report"],
    ["skill-benchmarks report --db benchmarks.sqlite --format json"],
  ),
  command(
    "list",
    "List available scenarios and skills.",
    "skill-benchmarks list [scenarios|skills|all]",
    [],
    [],
    [],
    ["skill-benchmarks list scenarios"],
    { name: "target", minimum: 0, maximum: 1, choices: listTargetChoices },
  ),
  command(
    "replay",
    "Read validated persisted execution evidence.",
    "skill-benchmarks replay [target] [options]",
    [
      stringFlag("target", "target", "Persisted events or replay JSON path"),
      stringFlag("runId", "run-id", "Canonical persisted run ID"),
      stringFlag("dbPath", "db", "Existing benchmark database"),
      stringFlag("outputDir", "output-dir", "Canonical benchmark output root"),
      stringFlag("format", "format", "Replay format", replayFormatChoices),
      stringFlag("outputPath", "output", "Replay output path"),
      numberFlag("speed", "speed", "TUI playback speed", { minimum: 0.1, maximum: 20 }),
    ],
    [],
    ["replay"],
    ["skill-benchmarks replay events.jsonl --format json"],
    { name: "target", minimum: 0, maximum: 1 },
  ),
  command(
    "help",
    "Display global or command help.",
    "skill-benchmarks help [command]",
    [],
    [],
    [],
    ["skill-benchmarks help run"],
    {
      name: "command",
      minimum: 0,
      maximum: 1,
      choices: ["run", "arena", "tournament", "report", "list", "replay", "help", "version"],
    },
    false,
  ),
  command(
    "version",
    "Display package version information.",
    "skill-benchmarks version",
    [],
    [],
    [],
    ["skill-benchmarks version"],
    undefined,
    false,
  ),
]);

export const commandSpecificationByName: Readonly<Record<CliCommandName, CliCommandSpecification>> =
  Object.freeze(
    Object.fromEntries(
      commandSpecifications.map((specification) => [specification.name, specification]),
    ),
  ) as Readonly<Record<CliCommandName, CliCommandSpecification>>;

const knownPublicFlagNames: ReadonlySet<string> = new Set([
  "help",
  "version",
  ...commandSpecifications.flatMap((specification) =>
    specification.flags.flatMap((entry) => [entry.name, ...entry.aliases]),
  ),
]);

export function findCommandSpecification(value: string): CliCommandSpecification | undefined {
  return commandSpecifications.find((specification) => specification.name === value);
}

export function isKnownPublicFlagName(value: string): boolean {
  return knownPublicFlagNames.has(value);
}

export function findFlagSpecification(
  commandSpec: CliCommandSpecification,
  value: string,
): CliFlagSpecification | undefined {
  return commandSpec.flags.find((entry) => entry.name === value || entry.aliases.includes(value));
}

export function formatFlagLabel(specification: CliFlagSpecification): string {
  const names = [...specification.aliases.map((alias) => `-${alias}`), `--${specification.name}`];
  const value = specification.kind === "boolean" ? "" : ` <${specification.valueName ?? "value"}>`;
  return `${names.join(", ")}${value}`;
}

export function isValueKind(value: CliFlagValueKind): boolean {
  return value !== "boolean";
}

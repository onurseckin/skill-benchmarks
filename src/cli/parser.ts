import { normalizeReportFilter } from "../reporting/report-cohorts.js";
import { CliInputError, type CliNormalizedValue } from "./grammar/types.js";
import {
  listTargetChoices,
  reasoningLevelChoices,
  replayFormatChoices,
  reportCardFormatChoices,
  reportFormatChoices,
  thinkingLevelChoices,
  tournamentModeChoices,
} from "./grammar/specification.js";
import { validateCliInput, type CliValidationContext } from "./grammar/validation.js";
import type {
  ArenaCliOptions,
  BenchmarkRunOptions,
  CliParsedArgs,
  ListOptions,
  ReplayCliOptions,
  ReportOptions,
  TournamentOptions,
} from "./types.js";

export function parseCliArgs(argv: readonly string[], context?: CliValidationContext): CliParsedArgs {
  const validated = validateCliInput(argv, context);
  const shared = {
    command: validated.command,
    helpRequested: validated.helpRequested,
    rawArgs: validated.rawArgs,
    flags: validated.options,
    positionals: validated.positionals,
  };
  if (validated.command === "run") {
    return Object.freeze({ ...shared, benchmarkOptions: buildRunOptions(validated.options, validated.positionals) });
  }
  if (validated.command === "arena") {
    return Object.freeze({ ...shared, arenaOptions: buildArenaOptions(validated.options) });
  }
  if (validated.command === "tournament") {
    return Object.freeze({ ...shared, tournamentOptions: buildTournamentOptions(validated.options) });
  }
  if (validated.command === "report") {
    return Object.freeze({ ...shared, reportOptions: buildReportOptions(validated.options) });
  }
  if (validated.command === "list") {
    return Object.freeze({ ...shared, listOptions: buildListOptions(validated.positionals) });
  }
  if (validated.command === "replay") {
    return Object.freeze({ ...shared, replayOptions: buildReplayOptions(validated.options, validated.positionals) });
  }
  return Object.freeze(shared);
}

function buildRunOptions(
  options: Readonly<Record<string, CliNormalizedValue>>,
  positionals: readonly string[]
): BenchmarkRunOptions {
  const scenarios = Object.freeze([...readArray(options.scenarioIds), ...positionals]);
  return Object.freeze({
    scenarioIds: scenarios,
    skillIds: freezeArray(options.skillIds),
    modelIds: freezeArray(options.modelIds),
    ...optionalString(options.providerId, "providerId"),
    ...optionalString(options.category, "category"),
    ...optionalNumber(options.concurrency, "concurrency"),
    ...optionalNumber(options.repetitions, "repetitions"),
    ...optionalNumber(options.temperature, "temperature"),
    ...optionalChoice(options.thinking, "thinking", thinkingLevelChoices),
    ...optionalChoice(options.reasoning, "reasoning", reasoningLevelChoices),
    ...optionalNumber(options.thinkingBudget, "thinkingBudget"),
    ...(options.matrixThinking === undefined
      ? {}
      : { matrixThinking: Object.freeze(readArray(options.matrixThinking).map((value) => requireChoice(value, thinkingLevelChoices))) }),
    ...optionalBoolean(options.dryRun, "dryRun"),
    ...optionalBoolean(options.live, "live"),
    ...optionalBoolean(options.mock, "mock"),
    ...optionalString(options.outputDir, "outputDir"),
    ...optionalNumber(options.timeoutSeconds, "timeoutSeconds"),
    ...optionalNumber(options.maxTurns, "maxTurns"),
    ...optionalNumber(options.maxCostUSD, "maxCostUSD"),
    ...optionalString(options.dbPath, "dbPath"),
  });
}

function buildArenaOptions(options: Readonly<Record<string, CliNormalizedValue>>): ArenaCliOptions {
  const skillIds = readArray(options.skillIds);
  return Object.freeze({
    scenarioIds: freezeArray(options.scenarioIds),
    ...(skillIds[0] === undefined ? {} : { skillId: skillIds[0] }),
    arenaModels: freezeArray(options.arenaModels),
    ...optionalBoolean(options.dryRun, "dryRun"),
    ...optionalBoolean(options.live, "live"),
    ...optionalBoolean(options.mock, "mock"),
    ...optionalString(options.outputDir, "outputDir"),
    ...optionalString(options.outputPath, "outputPath"),
  });
}

function buildTournamentOptions(options: Readonly<Record<string, CliNormalizedValue>>): TournamentOptions {
  return Object.freeze({
    scenarioIds: freezeArray(options.scenarioIds),
    skillIds: freezeArray(options.skillIds),
    modelIds: freezeArray(options.modelIds),
    ...optionalChoice(options.tournamentMode, "tournamentMode", tournamentModeChoices),
    ...optionalNumber(options.rounds, "rounds"),
    ...optionalBoolean(options.dryRun, "dryRun"),
    ...optionalBoolean(options.live, "live"),
    ...optionalBoolean(options.mock, "mock"),
    ...optionalString(options.outputDir, "outputDir"),
    ...optionalString(options.outputPath, "outputPath"),
  });
}

function buildReportOptions(options: Readonly<Record<string, CliNormalizedValue>>): ReportOptions {
  try {
    const filter = normalizeReportFilter({
      ...optionalArray(options.scenarioIds, "scenarioIds"),
      ...optionalArray(options.categories, "categories"),
      ...optionalArray(options.skillIds, "skillIds"),
      ...optionalArray(options.modelIds, "modelIds"),
      ...optionalArray(options.providerIds, "providerIds"),
      ...optionalArray(options.statuses, "statuses"),
      ...optionalArray(options.executionModes, "executionModes"),
      ...(options.simulated === undefined ? {} : { simulated: options.simulated === "true" }),
      ...optionalString(options.authority, "authority"),
      ...optionalArray(options.benchmarkCohorts, "benchmarkCohorts"),
      ...optionalArray(options.eligibilityStatuses, "eligibilityStatuses"),
      ...optionalArray(options.evaluationStatuses, "evaluationStatuses"),
      ...optionalArray(options.evidenceStatuses, "evidenceStatuses"),
      ...optionalString(options.fromDate, "fromDate"),
      ...optionalString(options.toDate, "toDate"),
    } as Parameters<typeof normalizeReportFilter>[0]);
    return Object.freeze({
      ...filter,
      ...optionalChoice(options.format, "format", reportFormatChoices),
      ...optionalString(options.outputPath, "outputPath"),
      ...optionalString(options.dbPath, "dbPath"),
      ...optionalString(options.title, "title"),
      ...optionalBoolean(options.includeCostEfficiency, "includeCostEfficiency"),
      ...optionalChoice(options.exportCard, "exportCard", reportCardFormatChoices),
      ...optionalString(options.cardOutputPath, "cardOutputPath"),
    });
  } catch (error) {
    if (error instanceof CliInputError) throw error;
    throw new CliInputError("invalid_value");
  }
}

function buildListOptions(positionals: readonly string[]): ListOptions {
  const target = requireChoice(positionals[0] ?? "all", listTargetChoices);
  return Object.freeze({ target });
}

function buildReplayOptions(
  options: Readonly<Record<string, CliNormalizedValue>>,
  positionals: readonly string[]
): ReplayCliOptions {
  return Object.freeze({
    ...(positionals[0] === undefined
      ? optionalString(options.target, "target")
      : { target: positionals[0] }),
    ...optionalString(options.runId, "runId"),
    ...optionalChoice(options.format, "format", replayFormatChoices),
    ...optionalString(options.outputPath, "outputPath"),
    ...optionalNumber(options.speed, "speed"),
    ...optionalString(options.dbPath, "dbPath"),
    ...optionalString(options.outputDir, "outputDir"),
  });
}

function readArray(value: CliNormalizedValue | undefined): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    if (value === undefined) return [];
    throw new CliInputError("invalid_value");
  }
  return value as readonly string[];
}

function freezeArray(value: CliNormalizedValue | undefined): readonly string[] {
  return Object.freeze([...readArray(value)]);
}

function optionalArray(value: CliNormalizedValue | undefined, key: string): Record<string, readonly string[]> {
  return value === undefined ? {} : { [key]: freezeArray(value) };
}

function optionalString(value: CliNormalizedValue | undefined, key: string): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== "string") throw new CliInputError("invalid_value");
  return { [key]: value };
}

function optionalNumber(value: CliNormalizedValue | undefined, key: string): Record<string, number> {
  if (value === undefined) return {};
  if (typeof value !== "number") throw new CliInputError("invalid_value");
  return { [key]: value };
}

function optionalBoolean(value: CliNormalizedValue | undefined, key: string): Record<string, boolean> {
  if (value === undefined) return {};
  if (typeof value !== "boolean") throw new CliInputError("invalid_value");
  return { [key]: value };
}

function optionalChoice<T extends string>(
  value: CliNormalizedValue | undefined,
  key: string,
  choices: readonly T[]
): Record<string, T> {
  if (value === undefined) return {};
  if (typeof value !== "string") throw new CliInputError("invalid_value");
  return { [key]: requireChoice(value, choices) };
}

function requireChoice<T extends string>(value: string, choices: readonly T[]): T {
  const match = choices.find((choice) => choice === value);
  if (match === undefined) throw new CliInputError("invalid_value");
  return match;
}

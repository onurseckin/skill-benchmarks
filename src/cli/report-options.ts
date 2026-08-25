import { normalizeReportFilter } from "../reporting/report-cohorts.js";
import type { CliOutputFormat, ReportOptions } from "./types.js";

type ParsedFlags = Readonly<Record<string, string | boolean | number | readonly string[]>>;

const allowedFlags = new Set([
  "f", "format", "o", "output", "out", "output-path", "outputPath",
  "db", "database", "db-path", "dbPath", "s", "scenario", "scenarios",
  "c", "category", "k", "skill", "skills", "m", "model", "models",
  "p", "provider", "status", "execution-mode", "executionMode", "simulated",
  "authority", "cohort", "eligibility", "evaluation-status", "evaluationStatus",
  "evidence-status", "evidenceStatus", "from-date", "fromDate", "to-date", "toDate",
  "title", "include-trends", "includeTrends", "include-cost", "includeCost",
  "include-cost-efficiency", "includeCostEfficiency", "export-card", "exportCard",
  "card", "report-card", "reportCard", "card-output", "cardOutputPath", "card-out", "cardOut",
]);
const valueOptionalFlags = new Set([
  "include-trends", "includeTrends", "include-cost", "includeCost",
  "include-cost-efficiency", "includeCostEfficiency",
]);

export function parseReportOptions(
  flags: ParsedFlags,
  positionals: readonly string[],
  argv: readonly string[]
): ReportOptions {
  if (positionals.length > 0) throw new TypeError("Report command does not accept positional arguments");
  validateReportTokens(argv);
  const format = optionalChoice(flags.format, "format", ["console", "json", "markdown", "html"] as const);
  const exportCard = optionalChoice(flags.exportCard, "export-card", ["svg", "html"] as const);
  const filter = normalizeReportFilter({
    ...optionalArray(flags.scenario, "scenarioIds"),
    ...optionalArray(flags.category, "categories"),
    ...optionalArray(flags.skill, "skillIds"),
    ...optionalArray(flags.model, "modelIds"),
    ...optionalArray(flags.provider, "providerIds"),
    ...optionalArray(flags.status, "statuses"),
    ...optionalArray(flags.executionMode, "executionModes"),
    ...optionalExplicitBoolean(flags.simulated, "simulated"),
    ...optionalScalar(flags.authority, "authority"),
    ...optionalArray(flags.cohort, "benchmarkCohorts"),
    ...optionalArray(flags.eligibility, "eligibilityStatuses"),
    ...optionalArray(flags.evaluationStatus, "evaluationStatuses"),
    ...optionalArray(flags.evidenceStatus, "evidenceStatuses"),
    ...optionalScalar(flags.fromDate, "fromDate"),
    ...optionalScalar(flags.toDate, "toDate"),
  } as Parameters<typeof normalizeReportFilter>[0]);
  return Object.freeze({
    ...filter,
    ...(format === undefined ? {} : { format: format as CliOutputFormat }),
    ...optionalScalar(flags.outputPath, "outputPath"),
    ...optionalScalar(flags.dbPath, "dbPath"),
    ...optionalScalar(flags.title, "title"),
    ...(flags.includeTrends === undefined ? {} : { includeTrends: requireBoolean(flags.includeTrends, "include-trends") }),
    ...(flags.includeCostEfficiency === undefined ? {} : { includeCostEfficiency: requireBoolean(flags.includeCostEfficiency, "include-cost") }),
    ...(exportCard === undefined ? {} : { exportCard }),
    ...optionalScalar(flags.cardOutputPath, "cardOutputPath"),
  });
}

function validateReportTokens(argv: readonly string[]): void {
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] as string;
    if (token.toLowerCase() === "report") continue;
    if (!token.startsWith("-")) continue;
    const separator = token.indexOf("=");
    const raw = token.replace(/^-{1,2}/, "").split("=", 1)[0] ?? "";
    if (!allowedFlags.has(raw)) throw new TypeError("Report command received an unknown option");
    if (separator >= 0 && token.slice(separator + 1).length === 0) throw new TypeError("Report command received an empty option value");
    if (separator < 0 && !valueOptionalFlags.has(raw)) {
      const next = argv[index + 1];
      if (next === undefined || next.length === 0 || next.startsWith("-")) throw new TypeError("Report command received a missing option value");
    }
  }
}

function optionalArray(value: unknown, key: string): Record<string, readonly string[]> {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new TypeError(`Report ${key} is invalid`);
  return { [key]: value as readonly string[] };
}

function optionalScalar(value: unknown, key: string): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`Report ${key} is invalid`);
  return { [key]: value.trim() };
}

function optionalExplicitBoolean(value: unknown, key: string): Record<string, boolean> {
  if (value === undefined) return {};
  if (value !== "true" && value !== "false") throw new TypeError(`Report ${key} requires true or false`);
  return { [key]: value === "true" };
}

function optionalChoice<T extends string>(value: unknown, key: string, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new TypeError(`Report ${key} is invalid`);
  return value as T;
}

function requireBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`Report ${key} is invalid`);
  return value;
}

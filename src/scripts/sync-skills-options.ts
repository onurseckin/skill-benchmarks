export interface SyncSkillsOptions {
  readonly category?: string;
  readonly skill?: string;
  readonly limit?: number;
  readonly dest: string;
  readonly catalog: string;
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly help: boolean;
}

export type SyncSkillsInputErrorCode =
  | "unknown_flag"
  | "missing_value"
  | "invalid_value"
  | "duplicate_argument"
  | "conflicting_arguments"
  | "unexpected_argument";

export class SyncSkillsInputError extends TypeError {
  readonly code: SyncSkillsInputErrorCode;

  constructor(code: SyncSkillsInputErrorCode) {
    super("Sync options are invalid");
    this.name = "SyncSkillsInputError";
    this.code = code;
  }
}

type SyncValueKind = "boolean" | "string" | "number";

interface SyncOptionSpecification {
  readonly key: keyof SyncSkillsOptions;
  readonly names: readonly string[];
  readonly kind: SyncValueKind;
}

const specifications: readonly SyncOptionSpecification[] = Object.freeze([
  Object.freeze({ key: "category", names: ["category", "c"], kind: "string" }),
  Object.freeze({ key: "skill", names: ["skill", "s"], kind: "string" }),
  Object.freeze({ key: "limit", names: ["limit", "l"], kind: "number" }),
  Object.freeze({ key: "dest", names: ["dest", "d"], kind: "string" }),
  Object.freeze({ key: "catalog", names: ["catalog"], kind: "string" }),
  Object.freeze({ key: "force", names: ["force", "f"], kind: "boolean" }),
  Object.freeze({ key: "dryRun", names: ["dry-run"], kind: "boolean" }),
  Object.freeze({ key: "help", names: ["help", "h"], kind: "boolean" }),
]);

const specificationByName: ReadonlyMap<string, SyncOptionSpecification> = new Map(
  specifications.flatMap((specification) => specification.names.map((name) => [name, specification]))
);

export function parseSyncSkillsOptions(args: readonly string[]): SyncSkillsOptions {
  const values: Partial<Record<keyof SyncSkillsOptions, string | number | boolean>> = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string;
    if (!argument.startsWith("-")) throw new SyncSkillsInputError("unexpected_argument");
    const parsed = parseToken(argument);
    const specification = specificationByName.get(parsed.name);
    if (specification === undefined) throw new SyncSkillsInputError("unknown_flag");
    const canonicalName = specification.names[0];
    const aliases = specification.names.slice(1);
    if ((parsed.prefix === "long" && parsed.name !== canonicalName)
      || (parsed.prefix === "short" && !aliases.includes(parsed.name))) {
      throw new SyncSkillsInputError("unknown_flag");
    }
    if (values[specification.key] !== undefined) throw new SyncSkillsInputError("duplicate_argument");
    if (specification.kind === "boolean") {
      if (parsed.attachedValue !== undefined) throw new SyncSkillsInputError("invalid_value");
      values[specification.key] = true;
      continue;
    }
    const candidate = parsed.attachedValue ?? args[index + 1];
    if (candidate === undefined || candidate.trim().length === 0) throw new SyncSkillsInputError("missing_value");
    if (parsed.attachedValue === undefined) {
      if (specification.kind !== "number" && candidate.startsWith("-")) {
        throw new SyncSkillsInputError("missing_value");
      }
      index += 1;
    }
    values[specification.key] = specification.kind === "number"
      ? parsePositiveInteger(candidate)
      : candidate.trim();
  }
  if (values.force === true && values.dryRun === true) {
    throw new SyncSkillsInputError("conflicting_arguments");
  }
  return Object.freeze({
    ...(typeof values.category === "string" ? { category: values.category } : {}),
    ...(typeof values.skill === "string" ? { skill: values.skill } : {}),
    ...(typeof values.limit === "number" ? { limit: values.limit } : {}),
    dest: typeof values.dest === "string" ? values.dest : ".skills",
    catalog: typeof values.catalog === "string" ? values.catalog : "skill-list/skill-list.md",
    force: values.force === true,
    dryRun: values.dryRun === true,
    help: values.help === true,
  });
}

function parseToken(argument: string): { readonly name: string; readonly prefix: "long" | "short"; readonly attachedValue?: string } {
  const prefix = argument.startsWith("--") ? "long" : "short";
  const prefixLength = prefix === "long" ? 2 : 1;
  const body = argument.slice(prefixLength);
  if (body.length === 0 || body.startsWith("-")) throw new SyncSkillsInputError("unknown_flag");
  const separator = body.indexOf("=");
  if (separator < 0) return { name: body, prefix };
  const name = body.slice(0, separator);
  if (name.length === 0) throw new SyncSkillsInputError("unknown_flag");
  return { name, prefix, attachedValue: body.slice(separator + 1) };
}

function parsePositiveInteger(value: string): number {
  if (!/^[+]?[0-9]+$/.test(value)) throw new SyncSkillsInputError("invalid_value");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new SyncSkillsInputError("invalid_value");
  return parsed;
}

export function getSyncSkillsHelp(): string {
  return [
    "Skills Catalog Synchronization CLI",
    "",
    "Usage:",
    "  bun run sync:skills [options]",
    "",
    "Options:",
    "  -c, --category <name>  Filter skills by category",
    "  -s, --skill <name>     Filter skills by name or ID",
    "  -l, --limit <number>   Maximum number of skills to synchronize",
    "  -d, --dest <dir>       Destination directory",
    "  --catalog <path>       Markdown catalog path",
    "  -f, --force            Replace existing cached skills",
    "  --dry-run              Read and filter without writing",
    "  -h, --help             Display this help",
    "",
    "Examples:",
    "  bun run sync:skills --dry-run --limit 1",
    "  bun run sync:skills --category debugging --limit 3",
  ].join("\n");
}

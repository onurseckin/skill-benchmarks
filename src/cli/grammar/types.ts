export type CliCommandName =
  | "run"
  | "arena"
  | "tournament"
  | "report"
  | "list"
  | "replay"
  | "help"
  | "version";

export type CliDiagnosticCode =
  | "unknown_command"
  | "unknown_flag"
  | "missing_value"
  | "invalid_value"
  | "duplicate_argument"
  | "conflicting_arguments"
  | "unexpected_argument"
  | "unsupported_argument"
  | "invalid_configuration"
  | "empty_matrix"
  | "duplicate_selector"
  | "scenario_catalog_invalid"
  | "scenario_unresolved"
  | "skill_unresolved"
  | "model_unresolved"
  | "provider_model_mismatch"
  | "replay_unavailable"
  | "report_database_unavailable"
  | "command_failed";

const diagnosticSummaries: Readonly<Record<CliDiagnosticCode, string>> = Object.freeze({
  unknown_command: "Unknown command.",
  unknown_flag: "Unknown option.",
  missing_value: "A required option value is missing.",
  invalid_value: "An option value is invalid.",
  duplicate_argument: "An option was supplied more than once.",
  conflicting_arguments: "Conflicting options were supplied.",
  unexpected_argument: "An unexpected argument was supplied.",
  unsupported_argument: "The option is not supported by this command.",
  invalid_configuration: "The command configuration is invalid.",
  empty_matrix: "The benchmark selection is empty.",
  duplicate_selector: "A benchmark selector is duplicated.",
  scenario_catalog_invalid: "The scenario catalog is unavailable or invalid.",
  scenario_unresolved: "The requested scenario is unavailable.",
  skill_unresolved: "The requested skill is unavailable.",
  model_unresolved: "The requested model is unavailable.",
  provider_model_mismatch: "The requested provider does not match the model.",
  replay_unavailable: "The requested replay evidence is unavailable or invalid.",
  report_database_unavailable: "The requested report database is unavailable.",
  command_failed: "The command could not be completed.",
});

export class CliInputError extends TypeError {
  readonly code: CliDiagnosticCode;

  constructor(code: CliDiagnosticCode) {
    super(diagnosticSummaries[code]);
    this.name = "CliInputError";
    this.code = code;
  }
}

export type CliFlagValueKind = "boolean" | "string" | "number" | "array";

export interface CliNumberConstraint {
  readonly integer?: boolean;
  readonly safeIntegerScale?: number;
  readonly minimum?: number;
  readonly exclusiveMinimum?: number;
  readonly maximum?: number;
}

export interface CliFlagSpecification {
  readonly key: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly kind: CliFlagValueKind;
  readonly valueName?: string;
  readonly description: string;
  readonly choices?: readonly string[];
  readonly number?: CliNumberConstraint;
}

export interface CliPositionalSpecification {
  readonly name: string;
  readonly minimum: number;
  readonly maximum?: number;
  readonly choices?: readonly string[];
}

export interface CliRequiredOptionSpecification {
  readonly key: string;
  readonly code: CliDiagnosticCode;
}

export type CliGrammarRule =
  | "run"
  | "arena"
  | "tournament"
  | "report"
  | "replay";

export interface CliCommandSpecification {
  readonly name: CliCommandName;
  readonly description: string;
  readonly usage: string;
  readonly flags: readonly CliFlagSpecification[];
  readonly positional?: CliPositionalSpecification;
  readonly requiredOptions: readonly CliRequiredOptionSpecification[];
  readonly rules: readonly CliGrammarRule[];
  readonly examples: readonly string[];
  readonly acceptsHelp: boolean;
}

export type CliNormalizedValue = string | number | boolean | readonly string[];

export interface ValidatedCliInput {
  readonly command: CliCommandName;
  readonly helpRequested: boolean;
  readonly options: Readonly<Record<string, CliNormalizedValue>>;
  readonly positionals: readonly string[];
  readonly rawArgs: readonly string[];
}

export function diagnosticSummary(code: CliDiagnosticCode): string {
  return diagnosticSummaries[code];
}

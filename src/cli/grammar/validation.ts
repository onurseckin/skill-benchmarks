import {
  commandSpecificationByName,
  findCommandSpecification,
  findFlagSpecification,
  isKnownPublicFlagName,
} from "./specification.js";
import {
  CliInputError,
  type CliCommandName,
  type CliCommandSpecification,
  type CliFlagSpecification,
  type CliNormalizedValue,
  type ValidatedCliInput,
} from "./types.js";

export interface CliValidationContext {
  readonly stdoutIsTTY: boolean;
}

const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function validateCliInput(
  argv: readonly string[],
  context: CliValidationContext = { stdoutIsTTY: process.stdout.isTTY === true }
): ValidatedCliInput {
  const discovery = discoverCommand(argv);
  const specification = commandSpecificationByName[discovery.command];
  const parsed = consumeTokens(specification, discovery.tokens);
  validatePositionals(specification, parsed.positionals);
  validateRequiredOptions(specification, parsed.options, parsed.helpRequested);
  validateRules(specification, parsed.options, parsed.positionals, parsed.helpRequested, context);
  return Object.freeze({
    command: discovery.command,
    helpRequested: parsed.helpRequested,
    options: Object.freeze(parsed.options),
    positionals: Object.freeze(parsed.positionals),
    rawArgs: Object.freeze([...argv]),
  });
}

function discoverCommand(argv: readonly string[]): { readonly command: CliCommandName; readonly tokens: readonly string[] } {
  const first = argv[0];
  if (first === undefined) return { command: "help", tokens: [] };
  if (first === "--help") {
    if (argv.length !== 1) throw new CliInputError("unexpected_argument");
    return { command: "help", tokens: [] };
  }
  if (first === "--version") return { command: "version", tokens: argv.slice(1) };
  if (first.startsWith("-")) throw new CliInputError("unknown_flag");
  const specification = findCommandSpecification(first);
  if (specification === undefined) throw new CliInputError("unknown_command");
  return { command: specification.name, tokens: argv.slice(1) };
}

interface ConsumedInput {
  readonly helpRequested: boolean;
  readonly options: Record<string, CliNormalizedValue>;
  readonly positionals: string[];
}

function consumeTokens(specification: CliCommandSpecification, tokens: readonly string[]): ConsumedInput {
  const options: Record<string, CliNormalizedValue> = {};
  const positionals: string[] = [];
  let helpRequested = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (token === "--") {
      if (specification.positional === undefined) throw new CliInputError("unexpected_argument");
      positionals.push(...tokens.slice(index + 1));
      break;
    }
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    const parsed = parseFlagToken(token);
    if (parsed.name === "help") {
      if (parsed.prefix !== "long") throw new CliInputError("unknown_flag");
      if (!specification.acceptsHelp) throw new CliInputError("unsupported_argument");
      if (parsed.attachedValue !== undefined) throw new CliInputError("invalid_value");
      if (helpRequested) throw new CliInputError("duplicate_argument");
      helpRequested = true;
      continue;
    }
    if (parsed.name === "version") throw new CliInputError("unsupported_argument");
    const flag = findFlagSpecification(specification, parsed.name);
    if (flag === undefined) {
      throw new CliInputError(isKnownPublicFlagName(parsed.name) ? "unsupported_argument" : "unknown_flag");
    }
    if ((parsed.prefix === "long" && parsed.name !== flag.name)
      || (parsed.prefix === "short" && !flag.aliases.includes(parsed.name))) {
      throw new CliInputError("unknown_flag");
    }
    const consumed = consumeFlagValue(flag, parsed.attachedValue, tokens, index);
    index += consumed.tokensConsumed;
    assignOption(options, flag, consumed.value);
  }
  return { helpRequested, options, positionals };
}

function parseFlagToken(token: string): { readonly name: string; readonly prefix: "long" | "short"; readonly attachedValue?: string } {
  const prefix = token.startsWith("--") ? "long" : "short";
  const prefixLength = prefix === "long" ? 2 : 1;
  const body = token.slice(prefixLength);
  if (body.length === 0 || body.startsWith("-")) throw new CliInputError("unknown_flag");
  const separator = body.indexOf("=");
  if (separator < 0) return { name: body, prefix };
  const name = body.slice(0, separator);
  if (name.length === 0) throw new CliInputError("unknown_flag");
  return { name, prefix, attachedValue: body.slice(separator + 1) };
}

function consumeFlagValue(
  specification: CliFlagSpecification,
  attachedValue: string | undefined,
  tokens: readonly string[],
  index: number
): { readonly value: CliNormalizedValue; readonly tokensConsumed: number } {
  if (specification.kind === "boolean") {
    if (attachedValue !== undefined) throw new CliInputError("invalid_value");
    const next = tokens[index + 1];
    if (next === "true" || next === "false") throw new CliInputError("invalid_value");
    return { value: true, tokensConsumed: 0 };
  }
  const candidate = attachedValue ?? tokens[index + 1];
  if (candidate === undefined || candidate.trim().length === 0) throw new CliInputError("missing_value");
  if (attachedValue === undefined && specification.kind !== "number" && candidate.startsWith("-")) {
    throw new CliInputError("missing_value");
  }
  const tokensConsumed = attachedValue === undefined ? 1 : 0;
  if (specification.kind === "number") {
    return { value: parseNumber(candidate, specification), tokensConsumed };
  }
  if (specification.kind === "array") {
    const values = candidate.split(",").map((value) => value.trim());
    if (values.length === 0 || values.some((value) => value.length === 0)) throw new CliInputError("invalid_value");
    validateChoices(values, specification.choices);
    if (new Set(values).size !== values.length) throw new CliInputError("duplicate_selector");
    return { value: Object.freeze(values), tokensConsumed };
  }
  const value = candidate.trim();
  validateChoices([value], specification.choices);
  return { value, tokensConsumed };
}

function parseNumber(value: string, specification: CliFlagSpecification): number {
  if (!numericPattern.test(value)) throw new CliInputError("invalid_value");
  const number = Number(value);
  const constraint = specification.number ?? {};
  if (!Number.isFinite(number)
    || (constraint.integer === true && !Number.isSafeInteger(number))
    || (constraint.safeIntegerScale !== undefined && !Number.isSafeInteger(number * constraint.safeIntegerScale))
    || (constraint.minimum !== undefined && number < constraint.minimum)
    || (constraint.exclusiveMinimum !== undefined && number <= constraint.exclusiveMinimum)
    || (constraint.maximum !== undefined && number > constraint.maximum)) {
    throw new CliInputError("invalid_value");
  }
  return number;
}

function validateChoices(values: readonly string[], choices: readonly string[] | undefined): void {
  if (choices !== undefined && values.some((value) => !choices.includes(value))) {
    throw new CliInputError("invalid_value");
  }
}

function assignOption(
  options: Record<string, CliNormalizedValue>,
  specification: CliFlagSpecification,
  value: CliNormalizedValue
): void {
  const existing = options[specification.key];
  if (specification.kind !== "array") {
    if (existing !== undefined) throw new CliInputError("duplicate_argument");
    options[specification.key] = value;
    return;
  }
  const incoming = value as readonly string[];
  const merged = existing === undefined ? [...incoming] : [...existing as readonly string[], ...incoming];
  if (new Set(merged).size !== merged.length) throw new CliInputError("duplicate_selector");
  options[specification.key] = Object.freeze(merged);
}

function validatePositionals(specification: CliCommandSpecification, positionals: readonly string[]): void {
  const positional = specification.positional;
  if (positional === undefined) {
    if (positionals.length > 0) throw new CliInputError("unexpected_argument");
    return;
  }
  if (positionals.length < positional.minimum
    || (positional.maximum !== undefined && positionals.length > positional.maximum)) {
    throw new CliInputError("unexpected_argument");
  }
  validateChoices(positionals, positional.choices);
}

function validateRequiredOptions(
  specification: CliCommandSpecification,
  options: Readonly<Record<string, CliNormalizedValue>>,
  helpRequested: boolean
): void {
  if (helpRequested) return;
  const missing = specification.requiredOptions.find((required) => options[required.key] === undefined);
  if (missing !== undefined) {
    throw new CliInputError(missing.code);
  }
}

function validateRules(
  specification: CliCommandSpecification,
  options: Readonly<Record<string, CliNormalizedValue>>,
  positionals: readonly string[],
  helpRequested: boolean,
  context: CliValidationContext
): void {
  for (const rule of specification.rules) {
    if (rule === "run") validateRun(options, positionals);
    if (rule === "arena") validateArena(options, helpRequested);
    if (rule === "tournament") validateTournament(options, helpRequested);
    if (rule === "report") validateReport(options, helpRequested);
    if (rule === "replay") validateReplay(options, positionals, helpRequested, context);
  }
}

function validateExecutionModes(options: Readonly<Record<string, CliNormalizedValue>>): void {
  if (options.mock === true && options.live === true) throw new CliInputError("conflicting_arguments");
}

function validateRun(options: Readonly<Record<string, CliNormalizedValue>>, positionals: readonly string[]): void {
  validateExecutionModes(options);
  const scenarios = [...readArray(options.scenarioIds), ...positionals];
  if (new Set(scenarios).size !== scenarios.length) throw new CliInputError("duplicate_selector");
}

function validateArena(options: Readonly<Record<string, CliNormalizedValue>>, helpRequested: boolean): void {
  validateExecutionModes(options);
  if (helpRequested) return;
  if (readArray(options.scenarioIds).length !== 1 || readArray(options.skillIds).length !== 1) {
    throw new CliInputError("invalid_configuration");
  }
  if (readArray(options.arenaModels).length !== 2) throw new CliInputError("empty_matrix");
}

function validateTournament(options: Readonly<Record<string, CliNormalizedValue>>, helpRequested: boolean): void {
  validateExecutionModes(options);
  if (helpRequested) return;
  const models = readArray(options.modelIds);
  if (readArray(options.scenarioIds).length === 0 || readArray(options.skillIds).length !== 1) {
    throw new CliInputError("invalid_configuration");
  }
  if (models.length < 2) throw new CliInputError("empty_matrix");
  const mode = readString(options.tournamentMode) ?? (models.length > 6 ? "swiss" : "round-robin");
  const maximumRounds = mode === "round-robin"
    ? models.length - 1 + models.length % 2
    : Math.max(1, Math.ceil(Math.log2(models.length)) + 1);
  const rounds = options.rounds;
  if (typeof rounds === "number" && rounds > maximumRounds) throw new CliInputError("invalid_value");
}

function validateReport(options: Readonly<Record<string, CliNormalizedValue>>, helpRequested: boolean): void {
  const format = readString(options.format) ?? "console";
  const outputPath = readString(options.outputPath);
  if (format === "console" && outputPath !== undefined) throw new CliInputError("unsupported_argument");
  if (!helpRequested && (format === "markdown" || format === "html") && outputPath === undefined) {
    throw new CliInputError("invalid_configuration");
  }
  const exportCard = readString(options.exportCard);
  const cardOutput = readString(options.cardOutputPath);
  if ((exportCard === undefined) !== (cardOutput === undefined)) throw new CliInputError("invalid_configuration");
}

function validateReplay(
  options: Readonly<Record<string, CliNormalizedValue>>,
  positionals: readonly string[],
  helpRequested: boolean,
  context: CliValidationContext
): void {
  const directSourceCount = positionals.length + (options.target === undefined ? 0 : 1);
  const canonicalCount = [options.runId, options.dbPath, options.outputDir].filter((value) => value !== undefined).length;
  if (directSourceCount > 1 || (directSourceCount > 0 && canonicalCount > 0)) {
    throw new CliInputError("conflicting_arguments");
  }
  if (!helpRequested && directSourceCount === 0 && canonicalCount === 0) throw new CliInputError("replay_unavailable");
  if (canonicalCount > 0 && canonicalCount !== 3) throw new CliInputError("replay_unavailable");
  const format = readString(options.format) ?? "tui";
  const output = readString(options.outputPath);
  const speed = options.speed;
  if (format === "tui") {
    if (output !== undefined) throw new CliInputError("unsupported_argument");
    if (!helpRequested && !context.stdoutIsTTY) throw new CliInputError("unsupported_argument");
  } else {
    if (speed !== undefined) throw new CliInputError("unsupported_argument");
    if (!helpRequested && format === "html" && output === undefined) throw new CliInputError("invalid_configuration");
  }
}

function readArray(value: CliNormalizedValue | undefined): readonly string[] {
  return Array.isArray(value) ? value as readonly string[] : [];
}

function readString(value: CliNormalizedValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

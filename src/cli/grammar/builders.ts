import type {
  CliCommandName,
  CliCommandSpecification,
  CliFlagSpecification,
  CliGrammarRule,
  CliNumberConstraint,
  CliPositionalSpecification,
  CliRequiredOptionSpecification,
} from "./types.js";

type FlagInput = Omit<CliFlagSpecification, "aliases"> & { readonly aliases?: readonly string[] };

export function flag(input: FlagInput): CliFlagSpecification {
  return Object.freeze({
    ...input,
    aliases: Object.freeze([...(input.aliases ?? [])]),
    ...(input.choices === undefined ? {} : { choices: Object.freeze([...input.choices]) }),
    ...(input.number === undefined ? {} : { number: Object.freeze({ ...input.number }) }),
  });
}

export function arrayFlag(
  key: string,
  name: string,
  description: string,
  aliases: readonly string[] = [],
  choices?: readonly string[],
): CliFlagSpecification {
  return flag({
    key,
    name,
    aliases,
    kind: "array",
    valueName: "values",
    description,
    ...(choices === undefined ? {} : { choices }),
  });
}

export function stringFlag(
  key: string,
  name: string,
  description: string,
  choices?: readonly string[],
): CliFlagSpecification {
  return flag({
    key,
    name,
    kind: "string",
    valueName: "value",
    description,
    ...(choices === undefined ? {} : { choices }),
  });
}

export function numberFlag(
  key: string,
  name: string,
  description: string,
  number: CliNumberConstraint,
  aliases: readonly string[] = [],
): CliFlagSpecification {
  return flag({ key, name, aliases, kind: "number", valueName: "number", description, number });
}

export function booleanFlag(key: string, name: string, description: string): CliFlagSpecification {
  return flag({ key, name, kind: "boolean", description });
}

export function command(
  name: CliCommandName,
  description: string,
  usage: string,
  flags: readonly CliFlagSpecification[],
  requiredOptions: readonly CliRequiredOptionSpecification[],
  rules: readonly CliGrammarRule[],
  examples: readonly string[],
  positional?: CliPositionalSpecification,
  acceptsHelp: boolean = true,
): CliCommandSpecification {
  return Object.freeze({
    name,
    description,
    usage,
    flags: Object.freeze([...flags]),
    requiredOptions: Object.freeze(
      requiredOptions.map((required) => Object.freeze({ ...required })),
    ),
    rules: Object.freeze([...rules]),
    examples: Object.freeze([...examples]),
    acceptsHelp,
    ...(positional === undefined
      ? {}
      : {
          positional: Object.freeze({
            ...positional,
            ...(positional.choices === undefined
              ? {}
              : { choices: Object.freeze([...positional.choices]) }),
          }),
        }),
  });
}

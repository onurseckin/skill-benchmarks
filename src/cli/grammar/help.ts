import pkg from "../../../package.json";
import {
  commandSpecifications,
  commandSpecificationByName,
  formatFlagLabel,
} from "./specification.js";
import type { CliCommandName, CliCommandSpecification } from "./types.js";

export function getVersionText(): string {
  return `skill-benchmarks v${pkg.version}`;
}

export function getHelpText(command?: CliCommandName): string {
  if (command === undefined) return renderGlobalHelp();
  const specification = commandSpecificationByName[command];
  if (specification === undefined) return renderGlobalHelp();
  return renderCommandHelp(specification);
}

function renderGlobalHelp(): string {
  const commands = commandSpecifications.map(
    (entry) => `  ${entry.name.padEnd(12)} ${entry.description}`,
  );
  return [
    "skill-benchmarks - Deterministic LLM Agent Skill Benchmarking Harness",
    "",
    "Usage:",
    "  skill-benchmarks <command> [options]",
    "",
    "Commands:",
    ...commands,
    "",
    "Global Options:",
    "  --help       Show global help.",
    "  --version    Show package version.",
    "",
    "Run 'skill-benchmarks help <command>' or 'skill-benchmarks <command> --help' for command grammar.",
  ].join("\n");
}

function renderCommandHelp(specification: CliCommandSpecification): string {
  const options = specification.flags.map(
    (entry) => `  ${formatFlagLabel(entry).padEnd(31)} ${entry.description}`,
  );
  if (specification.acceptsHelp)
    options.push("  --help                          Show this command's help.");
  return [
    "Usage:",
    `  ${specification.usage}`,
    "",
    "Description:",
    `  ${specification.description}`,
    "",
    "Options:",
    ...options,
    "",
    "Examples:",
    ...specification.examples.map((example) => `  ${example}`),
  ].join("\n");
}

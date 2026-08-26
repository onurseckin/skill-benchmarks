import { ScenarioLoader } from "../../runner/scenario-loader.js";
import { SkillRegistry } from "../../skills/registry.js";
import { bold, cyan, formatSectionHeader, green } from "../formatter.js";
import type { CliCommandResult, CliOutput, CliParsedArgs, ListOptions } from "../types.js";

export async function runListCommand(
  args: CliParsedArgs,
  output: CliOutput,
): Promise<CliCommandResult> {
  const startedAt = Date.now();
  const options = requireOptions(args.listOptions);
  output.stdout(
    `${formatSectionHeader(`Listing Benchmark Catalog Entities [target: ${options.target}]`)}\n`,
  );
  if (options.target === "scenarios" || options.target === "all") {
    const scenarios = new ScenarioLoader().loadAllScenarios();
    output.stdout(`${bold("\nAvailable Benchmark Scenarios:")}\n`);
    for (const scenario of scenarios) {
      output.stdout(
        `  ${cyan(scenario.id.padEnd(25))} ${scenario.name} [${scenario.category}] (${scenario.difficulty})\n`,
      );
    }
  }
  if (options.target === "skills" || options.target === "all") {
    const skills = new SkillRegistry().listSkills();
    output.stdout(`${bold("\nAvailable Skills:")}\n`);
    for (const skill of skills) {
      output.stdout(`  ${green(skill.name.padEnd(25))} ${skill.name} [v${skill.version}]\n`);
    }
  }
  return { success: true, exitCode: 0, durationMs: Date.now() - startedAt };
}

function requireOptions(options: ListOptions | undefined): ListOptions {
  if (options === undefined) throw new TypeError("List options are unavailable");
  return options;
}

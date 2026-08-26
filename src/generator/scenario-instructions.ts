import type {
  ExtractedCodebaseFeatures,
  GenerationTemplateDefinition,
  SyntheticScenarioConfig,
} from "./types.js";

export function generateScenarioInstructions(
  config: SyntheticScenarioConfig,
  template: GenerationTemplateDefinition,
  features: ExtractedCodebaseFeatures,
  sourcePath: string,
): string {
  const lines: string[] = [
    `You are tasked with executing the **${template.name}** task for skill \`${config.targetSkill}\`.`,
    `Target File: \`${sourcePath}\``,
    "",
    "### Objectives & Requirements:",
  ];
  if (features.interfaces.length > 0) {
    lines.push("1. **Interface Compliance**:");
    for (const iface of features.interfaces.slice(0, 3)) {
      lines.push(`   - Implement all properties and methods declared in \`${iface.name}\`.`);
    }
  }
  if (features.functions.length > 0) {
    lines.push("2. **Function Implementation**:");
    for (const fn of features.functions.slice(0, 3)) {
      lines.push(`   - Implement \`${fn.name}\` returning \`${fn.returnTypeString}\`.`);
    }
  }
  if (features.edgeConditions.length > 0) {
    lines.push("3. **Edge Case Handling & Robustness**:");
    for (const edge of features.edgeConditions.slice(0, 3)) {
      lines.push(`   - Correctly handle \`${edge.conditionType}\` conditions without crashing.`);
    }
  }
  lines.push("4. **Type Safety and Invariants:**");
  lines.push("   - Maintain strict TypeScript type safety with zero `any` usage.");
  lines.push(`   - Confine all changes exclusively to \`${sourcePath}\`.`);
  if (config.customInstructions) {
    lines.push("", "### Additional Notes:", config.customInstructions);
  }
  return lines.join("\n");
}

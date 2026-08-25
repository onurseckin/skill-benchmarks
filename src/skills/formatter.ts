import type { SkillManifest, SkillPromptFormatOptions, SkillRule } from "./types.js";
import type { SkillRegistry } from "./registry.js";
import { defaultSkillRegistry } from "./registry.js";
import { requireSubstantiveSkillManifest } from "./registry-support.js";

function formatRulesSection(prefix: string, title: string, rules: readonly SkillRule[], limit: number, withEx: boolean): string[] {
  if (rules.length === 0 || limit <= 0) return [];
  const lines: string[] = ["", `${prefix} ${title}`];
  for (let i = 0; i < Math.min(rules.length, limit); i++) {
    const r = rules[i];
    if (r !== undefined) {
      lines.push(`- **${r.title}**: ${r.description}`);
      if (withEx && r.examples !== undefined && r.examples.length > 0) {
        for (const ex of r.examples) lines.push(`  - Example: \`${ex}\``);
      }
    }
  }
  return lines;
}

export function formatSkillPrompt(
  manifestOrId: SkillManifest | string,
  options?: SkillPromptFormatOptions,
  registry?: SkillRegistry
): string {
  const reg = registry ?? defaultSkillRegistry;
  const m = typeof manifestOrId === "string"
    ? reg.requireSkill(manifestOrId)
    : requireSubstantiveSkillManifest(manifestOrId);

  const prefix = options !== undefined && options.headerPrefix !== undefined ? options.headerPrefix : "###";
  const subPrefix = `${prefix}#`;
  const withRules = options === undefined || options.includeRules === undefined ? true : options.includeRules;
  const withTools = options === undefined || options.includeTools === undefined ? true : options.includeTools;
  const withGuides = options === undefined || options.includeGuidelines === undefined ? true : options.includeGuidelines;
  const withEx = options === undefined || options.includeExamples === undefined ? true : options.includeExamples;
  const maxR = options !== undefined && options.maxRules !== undefined ? options.maxRules : Number.MAX_SAFE_INTEGER;

  const lines: string[] = [`${prefix} Skill: ${m.name} (v${m.version})`];
  if (m.description.length > 0) lines.push(m.description);

  const meta: string[] = [];
  if (m.category.length > 0) meta.push(`Category: ${m.category}`);
  if (m.tags.length > 0) meta.push(`Tags: ${m.tags.join(", ")}`);
  if (meta.length > 0) lines.push(meta.join(" | "));

  if (withRules && m.rules.length > 0) {
    const critical = m.rules.filter((r) => r.severity === "critical");
    const nonCritical = m.rules.filter((r) => r.severity !== "critical");
    lines.push(...formatRulesSection(subPrefix, "Critical Invariants (Must Follow):", critical, maxR, withEx));
    const rem = Math.max(0, maxR - critical.length);
    lines.push(...formatRulesSection(subPrefix, "Rules & Guidelines:", nonCritical, rem, withEx));
  }

  if (withGuides && m.guidelines.length > 0 && m.rules.length === 0) {
    lines.push("", `${subPrefix} Guidelines:`, ...m.guidelines.map((g) => `- ${g}`));
  }

  if (withTools && m.tools.length > 0) {
    lines.push("", `${subPrefix} Available Tools:`);
    for (const tool of m.tools) {
      lines.push(`- \`${tool.name}\`: ${tool.description}`);
      if (tool.command !== undefined && tool.command.length > 0) lines.push(`  - Command: \`${tool.command}\``);
    }
  }

  if (m.promptTemplate !== undefined && m.promptTemplate.length > 0) {
    lines.push("", `${subPrefix} Instructions:`, m.promptTemplate);
  }

  return lines.join("\n");
}

export function formatSkillsForAgentContext(
  manifestsOrIds: ReadonlyArray<SkillManifest | string>,
  options?: SkillPromptFormatOptions,
  registry?: SkillRegistry
): string {
  if (manifestsOrIds.length === 0) return "";
  const headerPrefix = options !== undefined && options.headerPrefix !== undefined ? options.headerPrefix : "##";
  const nestedOptions: SkillPromptFormatOptions = { ...options, headerPrefix: `${headerPrefix}#` };
  const formatted = manifestsOrIds.map((item) => formatSkillPrompt(item, nestedOptions, registry)).filter((s) => s.length > 0);
  if (formatted.length === 0) return "";
  return [`${headerPrefix} Active Agent Skills & Knowledge`, "The following skills and guidelines are active in this workspace:", "", formatted.join("\n\n---\n\n")].join("\n");
}

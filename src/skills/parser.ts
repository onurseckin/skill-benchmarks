import { readFile } from "node:fs/promises";
import type {
  SkillManifest,
  SkillRule,
  SkillTool,
  SkillScript,
  MarkdownSection,
  SkillParseOptions,
  RuleSeverity,
  SkillCategory,
} from "./types";

function parseYamlValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~" || trimmed === "") return null;
  if (!Number.isNaN(Number(trimmed)) && !trimmed.startsWith("0x") && trimmed !== "") {
    return Number(trimmed);
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    return inner ? inner.split(",").map((s) => parseYamlValue(s.trim())) : [];
  }
  return trimmed;
}

function parseYamlBlock(yamlText: string): Record<string, unknown> {
  const lines = yamlText.split(/\r?\n/);
  const result: Record<string, unknown> = {};
  let currentKey = "";
  let currentArray: unknown[] | null = null;
  let currentNestedObj: Record<string, unknown> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (line.startsWith("  ") || line.startsWith("\t")) {
      if (trimmed.startsWith("- ")) {
        if (currentArray !== null) {
          currentArray.push(parseYamlValue(trimmed.slice(2)));
        } else if (currentKey) {
          currentArray = [parseYamlValue(trimmed.slice(2))];
          result[currentKey] = currentArray;
        }
      } else {
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx > 0 && currentKey) {
          const subKey = trimmed.slice(0, colonIdx).trim();
          const subVal = trimmed.slice(colonIdx + 1).trim();
          if (currentNestedObj === null) {
            currentNestedObj = {};
            result[currentKey] = currentNestedObj;
          }
          currentNestedObj[subKey] = parseYamlValue(subVal);
        }
      }
      continue;
    }

    currentArray = null;
    currentNestedObj = null;

    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const valStr = line.slice(colonIdx + 1).trim();
      currentKey = key;
      result[key] = valStr.length === 0 ? null : parseYamlValue(valStr);
    }
  }

  return result;
}

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  content: string;
} {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---")) return { frontmatter: {}, content };
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match || typeof match[1] !== "string") return { frontmatter: {}, content };
  return { frontmatter: parseYamlBlock(match[1]), content: match[2] ?? "" };
}

export function parseMarkdownSections(content: string): MarkdownSection[] {
  const lines = content.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let currentHeading = "";
  let currentLevel = 0;
  const currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      if (currentHeading || currentLines.length > 0) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          content: currentLines.join("\n").trim(),
        });
        currentLines.length = 0;
      }
      currentLevel = headingMatch[1].length;
      currentHeading = headingMatch[2].trim();
    } else {
      currentLines.push(line);
    }
  }

  if (currentHeading || currentLines.length > 0) {
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      content: currentLines.join("\n").trim(),
    });
  }

  return sections;
}

function inferSeverity(text: string): RuleSeverity {
  const upper = text.toUpperCase();
  if (
    upper.includes("CRITICAL") ||
    upper.includes("MUST") ||
    upper.includes("NEVER") ||
    upper.includes("FORBIDDEN")
  ) {
    return "critical";
  }
  if (upper.includes("WARNING") || upper.includes("SHOULD NOT") || upper.includes("AVOID")) {
    return "warning";
  }
  if (upper.includes("INFO") || upper.includes("NOTE")) {
    return "info";
  }
  return "guideline";
}

export function extractRulesFromMarkdown(content: string): SkillRule[] {
  const sections = parseMarkdownSections(content);
  const rules: SkillRule[] = [];
  let ruleCounter = 1;
  const ruleKeywords = [
    "rule",
    "guideline",
    "invariant",
    "constraint",
    "best practice",
    "requirement",
    "policy",
  ];

  for (const section of sections) {
    const isRuleSection = ruleKeywords.some((kw) => section.heading.toLowerCase().includes(kw));
    const targetContent = isRuleSection ? section.content : "";
    if (!targetContent && !isRuleSection) continue;

    const lines = targetContent.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      const bulletMatch = trimmed.match(/^[-*+]\s+(.+)$/) || trimmed.match(/^\d+\.\s+(.+)$/);
      if (bulletMatch && bulletMatch[1]) {
        const itemText = bulletMatch[1].trim();
        const boldTitleMatch = itemText.match(/^\*\*([^*]+)\*\*[:\s-]*(.*)$/);
        const title =
          boldTitleMatch && boldTitleMatch[1] ? boldTitleMatch[1].trim() : `Rule ${ruleCounter}`;
        const description =
          boldTitleMatch && boldTitleMatch[2] && boldTitleMatch[2].trim()
            ? boldTitleMatch[2].trim()
            : itemText;
        rules.push({
          id: `rule-${ruleCounter}`,
          title,
          description,
          severity: inferSeverity(itemText),
          category: section.heading || undefined,
        });
        ruleCounter++;
      }
    }
  }

  return rules;
}

export function extractToolsFromMarkdown(content: string): SkillTool[] {
  const sections = parseMarkdownSections(content);
  const tools: SkillTool[] = [];
  const toolKeywords = ["tool", "command", "action", "mcp"];

  for (const section of sections) {
    const isToolSection = toolKeywords.some((kw) => section.heading.toLowerCase().includes(kw));
    if (isToolSection) {
      const subHeadingMatches = section.content.match(/^#{3,4}\s+(.+)$/gm);
      if (subHeadingMatches && subHeadingMatches.length > 0) {
        for (const rawSub of subHeadingMatches) {
          tools.push({
            name: rawSub.replace(/^#{3,4}\s+/, "").trim(),
            description: `Tool defined in ${section.heading}`,
          });
        }
      } else if (tools.length === 0 && section.content) {
        const commandMatch = section.content.match(/`([^`]+)`/);
        tools.push({
          name: section.heading.replace(/^tools?\s*:?\s*/i, "").trim() || "default-tool",
          description: section.content.split("\n")[0] || section.heading,
          command: commandMatch && commandMatch[1] ? commandMatch[1] : undefined,
        });
      }
    }
  }

  return tools;
}

function detectRuntime(filename: string): string {
  if (filename.endsWith(".sh") || filename.endsWith(".bash")) return "bash";
  if (filename.endsWith(".py")) return "python";
  if (filename.endsWith(".ts")) return "bun";
  if (filename.endsWith(".js") || filename.endsWith(".mjs")) return "node";
  if (filename.endsWith(".rb")) return "ruby";
  if (filename.endsWith(".go")) return "go";
  return "shell";
}

export function extractScriptsFromMarkdown(content: string): SkillScript[] {
  const scripts: SkillScript[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]+)?(?:\s+([^\n]+))?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null = codeBlockRegex.exec(content);

  while (match !== null) {
    const lang = match[1] || "";
    const meta = (match[2] || "").trim();
    const body = match[3] ?? "";
    let scriptPath = "";

    if (meta && (meta.includes("/") || meta.includes("."))) {
      scriptPath = meta;
    }

    if (scriptPath || lang === "bash" || lang === "sh" || lang === "python" || lang === "py") {
      const name = scriptPath
        ? scriptPath.split("/").pop() || "script"
        : `script-${scripts.length + 1}`;
      const finalPath = scriptPath || `scripts/${name}.${lang || "sh"}`;
      scripts.push({
        name,
        path: finalPath,
        runtime: detectRuntime(finalPath),
        content: body.trim(),
        isExecutable: true,
      });
    }

    match = codeBlockRegex.exec(content);
  }

  return scripts;
}

export function parseSkillContent(rawContent: string, options?: SkillParseOptions): SkillManifest {
  const { frontmatter, content } = parseFrontmatter(rawContent);
  const sections = parseMarkdownSections(content);
  const firstSection = sections[0];

  const rawName = typeof frontmatter.name === "string" ? frontmatter.name : "";
  const headerName =
    firstSection && firstSection.heading ? firstSection.heading.replace(/^#+\s*/, "").trim() : "";
  const name = rawName || headerName || "unnamed-skill";

  const rawVersion =
    typeof frontmatter.version === "string" || typeof frontmatter.version === "number"
      ? String(frontmatter.version)
      : "0.1.0";

  const rawDescription = typeof frontmatter.description === "string" ? frontmatter.description : "";
  const firstParagraphRaw =
    firstSection && firstSection.content ? firstSection.content.split(/\n\n/)[0] : "";
  const firstParagraph = firstParagraphRaw ? firstParagraphRaw.replace(/\n/g, " ").trim() : "";
  const description = rawDescription || firstParagraph || "No description provided";

  const rawCategory: SkillCategory =
    typeof frontmatter.category === "string"
      ? (frontmatter.category as SkillCategory)
      : options?.defaultCategory || "general";

  const rawTags: string[] = [];
  if (Array.isArray(frontmatter.tags)) {
    for (const t of frontmatter.tags) {
      if (typeof t === "string") rawTags.push(t);
    }
  }

  const rawRules: SkillRule[] = [];
  if (Array.isArray(frontmatter.rules)) {
    for (let idx = 0; idx < frontmatter.rules.length; idx++) {
      const item = frontmatter.rules[idx];
      if (typeof item === "string") {
        rawRules.push({
          id: `rule-${idx + 1}`,
          title: `Rule ${idx + 1}`,
          description: item,
          severity: inferSeverity(item),
        });
      } else if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        rawRules.push({
          id: typeof obj.id === "string" ? obj.id : `rule-${idx + 1}`,
          title: typeof obj.title === "string" ? obj.title : `Rule ${idx + 1}`,
          description: typeof obj.description === "string" ? obj.description : JSON.stringify(obj),
          severity:
            typeof obj.severity === "string"
              ? (obj.severity as RuleSeverity)
              : inferSeverity(String(obj.description || "")),
          category: typeof obj.category === "string" ? obj.category : undefined,
        });
      }
    }
  }

  const markdownRules = extractRulesFromMarkdown(content);
  const combinedRules = [...rawRules, ...markdownRules];

  const rawTools: SkillTool[] = [];
  if (Array.isArray(frontmatter.tools)) {
    for (const item of frontmatter.tools) {
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        if (typeof obj.name === "string") {
          rawTools.push({
            name: obj.name,
            description: typeof obj.description === "string" ? obj.description : "",
            command: typeof obj.command === "string" ? obj.command : undefined,
          });
        }
      }
    }
  }
  const markdownTools = extractToolsFromMarkdown(content);
  const combinedTools = [...rawTools, ...markdownTools];
  const markdownScripts = extractScriptsFromMarkdown(content);

  const guidelines: string[] = [];
  for (const rule of combinedRules) {
    if (!guidelines.includes(rule.description)) {
      guidelines.push(rule.description);
    }
  }

  return {
    name,
    version: rawVersion,
    description,
    category: rawCategory,
    tags: rawTags,
    author: typeof frontmatter.author === "string" ? frontmatter.author : undefined,
    repository: typeof frontmatter.repository === "string" ? frontmatter.repository : undefined,
    license: typeof frontmatter.license === "string" ? frontmatter.license : undefined,
    rules: combinedRules,
    tools: combinedTools,
    scripts: markdownScripts,
    guidelines,
    promptTemplate:
      typeof frontmatter.promptTemplate === "string" ? frontmatter.promptTemplate : undefined,
    dependencies: Array.isArray(frontmatter.dependencies)
      ? frontmatter.dependencies.filter((d): d is string => typeof d === "string")
      : [],
    rawContent,
    frontmatter,
    metadata:
      typeof frontmatter.metadata === "object" && frontmatter.metadata !== null
        ? (frontmatter.metadata as Record<string, unknown>)
        : undefined,
  };
}

export async function parseSkillFile(
  filePath: string,
  options?: SkillParseOptions,
): Promise<SkillManifest> {
  const content = await readFile(filePath, "utf-8");
  return parseSkillContent(content, {
    ...options,
    sourcePath: filePath,
  });
}

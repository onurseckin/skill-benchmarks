import { resolve, isAbsolute, sep } from "node:path";
import type { SkillManifest, SkillValidationResult } from "./types";

export class SkillValidationError extends Error {
  readonly skillName: string;
  readonly issues: ReadonlyArray<string>;

  constructor(skillName: string, issues: ReadonlyArray<string>) {
    super(`Skill validation failed for '${skillName}': ${issues.join("; ")}`);
    this.name = "SkillValidationError";
    this.skillName = skillName;
    this.issues = issues;
  }
}

const DANGEROUS_PAYLOAD_PATTERNS: readonly RegExp[] = [
  new RegExp(":\\(\\)\\s*\\{\\s*:(\\|):&\\s*\\};:"),
  new RegExp("rm\\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\\s+([/~]|\\$HOME|\\$\\{HOME\\})", "i"),
  new RegExp("mkfs(\\.[a-z0-9]+)?\\s+", "i"),
  new RegExp("dd\\s+if=\\/dev\\/(zero|urandom|random)\\s+of=\\/dev\\/", "i"),
  new RegExp("(?:curl|wget)\\s+[^|;&\\n]+\\|\\s*(?:ba|z)?sh", "i"),
  new RegExp("\\/dev\\/tcp\\/[0-9a-zA-Z_.-]+\\/[0-9]+", "i"),
  new RegExp("nc\\s+-[e|c]\\s+", "i"),
  new RegExp("bash\\s+-i\\s+>&", "i"),
  new RegExp("chmod\\s+(?:-R\\s+)?777\\s+[/~]", "i"),
];

const ROOT_SYSTEM_PREFIXES: readonly string[] = [
  "/etc",
  "/usr",
  "/var",
  "/bin",
  "/sbin",
  "/dev",
  "/proc",
  "/sys",
  "/root",
  "/home",
  "/tmp",
  "C:\\",
  "\\\\",
];

export function validatePathSafety(
  targetPath: string,
  basePath?: string
): boolean {
  if (!targetPath || typeof targetPath !== "string") {
    return false;
  }

  if (targetPath.includes("\0")) {
    return false;
  }

  const lower = targetPath.toLowerCase();
  if (
    lower.includes("%2e%2e") ||
    lower.includes("%2f") ||
    lower.includes("%5c")
  ) {
    return false;
  }

  const segments = targetPath.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === "..") {
      return false;
    }
  }

  if (basePath) {
    try {
      const normalizedBase = resolve(basePath);
      const resolved = isAbsolute(targetPath)
        ? resolve(targetPath)
        : resolve(basePath, targetPath);
      if (
        resolved !== normalizedBase &&
        !resolved.startsWith(normalizedBase + sep)
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  for (const rootPrefix of ROOT_SYSTEM_PREFIXES) {
    if (targetPath.startsWith(rootPrefix)) {
      return false;
    }
  }

  return true;
}

export function validateSecurityInvariants(manifest: SkillManifest): {
  safe: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  const dangerousNameChars = /[;&|`$<>\x00-\x1f]/;

  if (dangerousNameChars.test(manifest.name)) {
    issues.push(`Skill name contains forbidden shell metacharacters: ${manifest.name}`);
  }

  for (const script of manifest.scripts) {
    if (!validatePathSafety(script.path)) {
      issues.push(`Script path violates path safety invariants: ${script.path}`);
    }

    if (script.content) {
      for (const pattern of DANGEROUS_PAYLOAD_PATTERNS) {
        if (pattern.test(script.content)) {
          issues.push(
            `Script '${script.name}' contains potentially malicious payload pattern: ${pattern.source}`
          );
        }
      }
    }
  }

  for (const tool of manifest.tools) {
    if (dangerousNameChars.test(tool.name)) {
      issues.push(`Tool name contains forbidden characters: ${tool.name}`);
    }

    if (tool.command) {
      for (const pattern of DANGEROUS_PAYLOAD_PATTERNS) {
        if (pattern.test(tool.command)) {
          issues.push(
            `Tool '${tool.name}' command contains potentially malicious payload pattern: ${pattern.source}`
          );
        }
      }
    }
  }

  return {
    safe: issues.length === 0,
    issues,
  };
}

export function validateSkillManifest(
  manifest: SkillManifest
): SkillValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest.name || typeof manifest.name !== "string") {
    errors.push("Skill manifest must have a non-empty string 'name'");
  } else {
    const trimmedName = manifest.name.trim();
    if (trimmedName.length === 0 || trimmedName.length > 128) {
      errors.push("Skill name length must be between 1 and 128 characters");
    }
    const nameRegex = /^[a-zA-Z0-9_\-\.@\/]+$/;
    if (!nameRegex.test(trimmedName)) {
      errors.push(`Skill name contains invalid characters: ${trimmedName}`);
    }
  }

  if (!manifest.version || typeof manifest.version !== "string") {
    errors.push("Skill manifest must have a non-empty string 'version'");
  }

  if (!manifest.description || typeof manifest.description !== "string") {
    warnings.push("Skill manifest description is missing or empty");
  }

  if (!manifest.category || typeof manifest.category !== "string") {
    warnings.push("Skill manifest category is missing or empty");
  }

  if (!Array.isArray(manifest.tags)) {
    errors.push("Skill manifest 'tags' must be an array");
  }

  if (!Array.isArray(manifest.rules)) {
    errors.push("Skill manifest 'rules' must be an array");
  } else {
    for (let i = 0; i < manifest.rules.length; i++) {
      const rule = manifest.rules[i];
      if (!rule.id || typeof rule.id !== "string") {
        errors.push(`Rule at index ${i} is missing a valid 'id'`);
      }
      if (!rule.description || typeof rule.description !== "string") {
        errors.push(`Rule at index ${i} is missing a valid 'description'`);
      }
    }
  }

  if (!Array.isArray(manifest.tools)) {
    errors.push("Skill manifest 'tools' must be an array");
  } else {
    for (let i = 0; i < manifest.tools.length; i++) {
      const tool = manifest.tools[i];
      if (!tool.name || typeof tool.name !== "string") {
        errors.push(`Tool at index ${i} is missing a valid 'name'`);
      }
    }
  }

  if (!Array.isArray(manifest.scripts)) {
    errors.push("Skill manifest 'scripts' must be an array");
  } else {
    for (let i = 0; i < manifest.scripts.length; i++) {
      const script = manifest.scripts[i];
      if (!script.name || typeof script.name !== "string") {
        errors.push(`Script at index ${i} is missing a valid 'name'`);
      }
      if (!script.path || typeof script.path !== "string") {
        errors.push(`Script at index ${i} is missing a valid 'path'`);
      }
    }
  }

  const securityCheck = validateSecurityInvariants(manifest);
  if (!securityCheck.safe) {
    errors.push(...securityCheck.issues);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    checkedRulesCount: Array.isArray(manifest.rules) ? manifest.rules.length : 0,
    securityPass: securityCheck.safe,
    details: {
      errorCount: errors.length,
      warningCount: warnings.length,
      ruleCount: Array.isArray(manifest.rules) ? manifest.rules.length : 0,
      toolCount: Array.isArray(manifest.tools) ? manifest.tools.length : 0,
      scriptCount: Array.isArray(manifest.scripts) ? manifest.scripts.length : 0,
    },
  };
}

export function assertValidSkill(manifest: SkillManifest): void {
  const result = validateSkillManifest(manifest);
  if (!result.valid || !result.securityPass) {
    throw new SkillValidationError(
      manifest.name || "unknown",
      result.errors
    );
  }
}

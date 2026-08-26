import type { CanonicalSkill, CanonicalSkillDomain, SkillCategory } from "./types.js";

function parseAuthorFromSource(source: string): {
  readonly name: string;
  readonly handle: string;
  readonly repository: string;
} {
  const parts = source.split("/");
  if (parts.length >= 2) {
    const handle = parts[0] ?? "unknown";
    return { name: handle, handle, repository: source };
  }
  return { name: source, handle: source, repository: source };
}

function parseInstalls(raw: string): number {
  const normalized = raw.trim().toUpperCase().replace(/,/g, "");
  if (normalized.endsWith("M")) {
    const value = Number.parseFloat(normalized.slice(0, -1));
    return Number.isNaN(value) ? 0 : Math.round(value * 1000000);
  }
  if (normalized.endsWith("K")) {
    const value = Number.parseFloat(normalized.slice(0, -1));
    return Number.isNaN(value) ? 0 : Math.round(value * 1000);
  }
  const value = Number.parseFloat(normalized);
  return Number.isNaN(value) ? 0 : Math.round(value);
}

export function createCanonicalSkill(
  id: string,
  name: string,
  domain: CanonicalSkillDomain,
  category: SkillCategory,
  source: string,
  installsDisplay: string,
  description: string,
  tags: readonly string[],
): CanonicalSkill {
  return {
    id,
    name,
    domain,
    category,
    source,
    sourceType: source.includes("/") ? "git" : "local",
    author: parseAuthorFromSource(source),
    installs: { rawInstalls: parseInstalls(installsDisplay), display: installsDisplay },
    description,
    tags,
    status: "available",
  };
}

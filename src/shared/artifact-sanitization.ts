import { createHash } from "node:crypto";

const credentialPattern = /(?:authorization\s*:\s*bearer\s+\S+|bearer\s+\S+|(?:api[_-]?key|token|secret|password)\s*[=:]\s*\S+|sk-[a-zA-Z0-9_-]+)/i;
const errorKeyPattern = /^(?:error|exception|stack|failure)|(?:Error|Exception|Stack|Failure)$/;
const safePathSegmentPattern = /^[a-zA-Z0-9_.-]+$/;

export function sanitizeBenchmarkArtifactValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeBenchmarkArtifactText(value);
  if (Array.isArray(value)) return value.map(sanitizeBenchmarkArtifactValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !isSensitiveArtifactPropertyKey(key))
    .map(([key, child]) => [key, sanitizeArtifactProperty(key, child)]));
}

export function sanitizeBenchmarkArtifactText(value: string): string {
  return credentialPattern.test(value) ? "redacted sensitive content" : value;
}

export function createSafeArtifactPathSegment(value: string, fallback: string): string {
  const normalized = value.trim();
  if (safePathSegmentPattern.test(normalized) && normalized !== "." && normalized !== "..") return normalized;
  const prefix = normalized.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `${prefix.length > 0 ? prefix : fallback}-${digest}`;
}

function sanitizeArtifactProperty(key: string, value: unknown): unknown {
  if (errorKeyPattern.test(key) && typeof value === "string") return "execution failed";
  return sanitizeBenchmarkArtifactValue(value);
}

function isSensitiveArtifactPropertyKey(key: string): boolean {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalizedKey.includes("authorization")
    || normalizedKey.includes("apikey")
    || normalizedKey.includes("secret")
    || normalizedKey.includes("password")
    || normalizedKey.includes("credential")
    || normalizedKey.includes("authtoken")
    || normalizedKey.includes("accesstoken")
    || normalizedKey.includes("refreshtoken")
    || normalizedKey.endsWith("token") && !normalizedKey.includes("totaltoken");
}

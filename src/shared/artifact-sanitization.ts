import { createHash } from "node:crypto";

const credentialPattern = /(?:authorization\s*:\s*(?:basic|bearer)\s+\S+|bearer\s+[a-zA-Z0-9_.-]{12,}|(?:api[_-]?key|token|secret|password)\s*[=:]\s*\S+|["']?[a-z0-9_-]*(?:key|token)["']?\s*[=:]\s*\S+|sk-[a-zA-Z0-9_-]+)/i;
const errorKeyPattern = /^(?:error|exception|stack|failure)|(?:Error|Exception|Stack|Failure)$/;
const safePathSegmentPattern = /^[a-zA-Z0-9_.-]+$/;

export function sanitizeBenchmarkArtifactValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeBenchmarkArtifactText(value);
  if (Array.isArray(value)) return sanitizeArtifactArray(value);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value);
  if (containsBasicAuthorizationScheme(entries)) return redactArtifactStringValues(value);
  return Object.fromEntries(entries
    .filter(([key]) => !isSensitiveArtifactPropertyKey(key))
    .map(([key, child]) => [key, sanitizeArtifactProperty(key, child)]));
}

export function sanitizeBenchmarkArtifactText(value: string): string {
  const sanitizedJson = sanitizeJsonArtifactText(value);
  if (sanitizedJson !== undefined) return sanitizedJson;
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
  if (isHeaderCollectionKey(key) && Array.isArray(value)) return sanitizeHeaderCollection(value);
  return sanitizeBenchmarkArtifactValue(value);
}

function sanitizeArtifactArray(value: readonly unknown[]): readonly unknown[] {
  return value.map(sanitizeBenchmarkArtifactValue);
}

function sanitizeHeaderCollection(value: readonly unknown[]): readonly unknown[] {
  const strings = value.filter((item): item is string => typeof item === "string");
  const hasAuthorizationHeader = strings.some((item) => item.trim().toLowerCase() === "authorization");
  const hasBasicScheme = strings.some((item) => /^basic(?:\s+\S+)?$/i.test(item.trim()));
  if (hasAuthorizationHeader && hasBasicScheme) return value.map(redactArtifactStringValues);
  return sanitizeArtifactArray(value);
}

function containsBasicAuthorizationScheme(entries: readonly (readonly [string, unknown])[]): boolean {
  return entries.some(([key, value]) => normalizeArtifactKey(key) === "scheme" && typeof value === "string" && value.trim().toLowerCase() === "basic");
}

function redactArtifactStringValues(value: unknown): unknown {
  if (typeof value === "string") return "redacted sensitive content";
  if (Array.isArray(value)) return value.map(redactArtifactStringValues);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactArtifactStringValues(child)]));
}

function sanitizeJsonArtifactText(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed !== null && typeof parsed === "object") {
      return JSON.stringify(sanitizeBenchmarkArtifactValue(parsed));
    }
  } catch {
  }
  return undefined;
}

function isSensitiveArtifactPropertyKey(key: string): boolean {
  const keyTokens = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return keyTokens.some((token) => (
    token === "authorization"
    || token === "cookie"
    || token === "secret"
    || token === "password"
    || token === "credential"
    || token === "private"
    || token === "api"
    || token === "key"
    || token === "token"
  ));
}

function isHeaderCollectionKey(key: string): boolean {
  const normalized = normalizeArtifactKey(key);
  return normalized === "header" || normalized === "headers";
}

function normalizeArtifactKey(key: string): string {
  return key.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

import { requireCondition } from "./assertions.js";

const forbiddenClaimFragments = [
  "score",
  "actualcost",
  "rank",
  "winner",
  "champion",
  "significance",
  "regression",
] as const;
const forbiddenClaimValues = [
  "score",
  "compositescore",
  "pass",
  "passed",
  "passrate",
  "actualcost",
  "rank",
  "ranking",
  "elo",
  "elorating",
  "winner",
  "champion",
  "significance",
  "regression",
] as const;

function normalizeClaimText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isForbiddenClaimKey(value: string): boolean {
  const normalized = normalizeClaimText(value);
  if (
    forbiddenClaimFragments.some((fragment) => normalized.includes(fragment)) ||
    /^(?:win|wins|winning|winner|winners)$/.test(normalized) ||
    normalized === "elo" ||
    normalized.includes("elorating")
  )
    return true;
  if (normalized === "requiredcheckspassed") return false;
  return (
    normalized === "pass" ||
    normalized === "passed" ||
    normalized.startsWith("pass") ||
    normalized.endsWith("passed") ||
    normalized.includes("passrate") ||
    normalized.includes("passedbenchmark") ||
    normalized.includes("benchmarkpass")
  );
}

function isForbiddenClaimValue(value: string): boolean {
  const claimPhrase =
    /\b(?:composite[\s_-]*scores?|benchmark[\s_-]*(?:pass(?:es|ed)?|score(?:s|d)?|rank(?:s|ed|ing)?|win(?:s|ning|ners?)?)|pass(?:es|ed)?|score(?:s|d)?|rank(?:s|ed|ing)?|elo(?:[\s_-]*ratings?)?|win(?:s|ning|ners?)?|champions?|actual[\s_-]*costs?|significance|regressions?)\b/i;
  if (claimPhrase.test(value)) return true;
  const normalized = normalizeClaimText(value);
  return forbiddenClaimValues.some((claim) => normalized === claim);
}

export function requireNoDiagnosticClaims(value: unknown, code: string): void {
  if (typeof value === "string") {
    requireCondition(!isForbiddenClaimValue(value), code);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) requireNoDiagnosticClaims(entry, code);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    requireCondition(!isForbiddenClaimKey(key), code);
    requireNoDiagnosticClaims(entry, code);
  }
}

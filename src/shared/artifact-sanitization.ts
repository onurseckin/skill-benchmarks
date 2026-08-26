import { createHash } from "node:crypto";

const redactedSensitiveContent = "redacted sensitive content";
const credentialPattern =
  /(?:authorization\s*:\s*bearer\s+\S+|bearer\s+[a-zA-Z0-9_.-]{12,}|(?:api[_-]?key|token|secret|password)\s*[=:]\s*\S+|["']?[a-z0-9_-]*(?:key|token)["']?\s*[=:]\s*\S+|sk-[a-zA-Z0-9_-]+)/i;
const completeBasicAuthorizationPattern = /authorization\s*:\s*basic\s+\S+/gi;
const completeBasicAuthorizationAtEndPattern = /authorization\s*:\s*basic\s+\S+$/i;
const standaloneBasicTokenPattern = /(^|[\r\n])([ \t]*basic[ \t]+)(\S+)/gi;
const incompleteBasicAuthorizationPattern = /authorization\s*:\s*basic\s*$/i;
const incompleteAuthorizationPattern = /authorization\s*:\s*$/i;
const errorKeyPattern = /^(?:error|exception|stack|failure)|(?:Error|Exception|Stack|Failure)$/;
const safePathSegmentPattern = /^[a-zA-Z0-9_.-]+$/;
const sequenceBudget = 8;

type AuthorizationSequenceStage = "idle" | "scheme" | "credential";
type ArtifactStringRole = "content" | "descriptor" | "neutral" | "sequence";

class BasicAuthorizationSequenceNormalizer {
  private stage: AuthorizationSequenceStage = "idle";
  private remainingBudget = 0;
  private credentialMayContinue = false;

  public sanitizeValue(value: unknown, propertyKey?: string): unknown {
    if (typeof value === "string")
      return this.sanitizeText(value, classifyArtifactStringRole(propertyKey));
    if (Array.isArray(value)) return value.map((child) => this.sanitizeValue(child));
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, this.sanitizeValue(child, key)]),
    );
  }

  public sanitizeText(value: string, role: ArtifactStringRole = "sequence"): string {
    const completeRedaction = value.replace(
      completeBasicAuthorizationPattern,
      redactedSensitiveContent,
    );
    if (completeRedaction !== value) {
      this.credentialMayContinue = completeBasicAuthorizationAtEndPattern.test(value);
      this.reset();
      return completeRedaction;
    }
    const standaloneRedaction = redactStandaloneBasicCredentials(value);
    if (standaloneRedaction.value !== value) {
      this.credentialMayContinue = standaloneRedaction.continues;
      this.reset();
      return standaloneRedaction.value;
    }
    if (incompleteBasicAuthorizationPattern.test(value)) {
      this.expect("credential");
      return value.replace(incompleteBasicAuthorizationPattern, redactedSensitiveContent);
    }
    if (incompleteAuthorizationPattern.test(value)) {
      this.expect("scheme");
      return value.replace(incompleteAuthorizationPattern, redactedSensitiveContent);
    }

    const normalized = value.trim().toLowerCase();
    if (this.stage === "scheme") return this.sanitizeExpectedScheme(value, normalized, role);
    if (this.stage === "credential") return this.sanitizeExpectedCredential(value, role);
    if (normalized === "authorization") {
      this.expect("scheme");
      return redactedSensitiveContent;
    }
    if (role === "descriptor" && normalized === "basic") {
      this.expect("credential");
      return redactedSensitiveContent;
    }
    return value;
  }

  private sanitizeExpectedScheme(
    value: string,
    normalized: string,
    role: ArtifactStringRole,
  ): string {
    if (/^basic\s+\S+$/i.test(value.trim())) {
      this.reset();
      return redactedSensitiveContent;
    }
    if (normalized === "basic") {
      this.expect("credential");
      return redactedSensitiveContent;
    }
    this.consumeBudget();
    if (role === "content" || role === "sequence") this.reset();
    return value;
  }

  private sanitizeExpectedCredential(value: string, role: ArtifactStringRole): string {
    if ((role === "content" || role === "sequence") && /\S/.test(value)) {
      this.credentialMayContinue = !/\S\s/.test(value);
      this.reset();
      return value.replace(/^(\s*)\S+/, `$1${redactedSensitiveContent}`);
    }
    this.consumeBudget();
    return value;
  }

  private expect(stage: Exclude<AuthorizationSequenceStage, "idle">): void {
    this.stage = stage;
    this.remainingBudget = sequenceBudget;
  }

  private consumeBudget(): void {
    this.remainingBudget -= 1;
    if (this.remainingBudget <= 0) this.reset();
  }

  private reset(): void {
    this.stage = "idle";
    this.remainingBudget = 0;
  }

  public takeCredentialContinuation(): boolean {
    const credentialMayContinue = this.credentialMayContinue;
    this.credentialMayContinue = false;
    return credentialMayContinue;
  }
}

export class BenchmarkArtifactTextStreamSanitizer {
  private readonly normalizer = new BasicAuthorizationSequenceNormalizer();
  private credentialContinuation = false;

  public sanitize(value: string): string {
    if (this.credentialContinuation) return this.sanitizeCredentialContinuation(value);
    const sanitized = sanitizeNormalizedArtifactText(this.normalizer.sanitizeText(value));
    this.credentialContinuation = this.normalizer.takeCredentialContinuation();
    return sanitized;
  }

  private sanitizeCredentialContinuation(value: string): string {
    if (value.length === 0) return value;
    if (/^\s/.test(value)) {
      this.credentialContinuation = false;
      return this.sanitize(value);
    }
    const suffixStart = value.search(/\s/);
    if (suffixStart < 0) return redactedSensitiveContent;
    this.credentialContinuation = false;
    return redactedSensitiveContent + this.sanitize(value.slice(suffixStart));
  }
}

export class BenchmarkArtifactValueStreamSanitizer {
  private readonly normalizer = new BasicAuthorizationSequenceNormalizer();

  public sanitize(value: unknown): unknown {
    return sanitizeNormalizedArtifactValue(this.normalizer.sanitizeValue(value));
  }
}

export function sanitizeBenchmarkArtifactValue(value: unknown): unknown {
  const normalized = new BasicAuthorizationSequenceNormalizer().sanitizeValue(value);
  return sanitizeNormalizedArtifactValue(normalized);
}

export function sanitizeBenchmarkArtifactText(value: string): string {
  const normalized = new BasicAuthorizationSequenceNormalizer().sanitizeText(value);
  return sanitizeNormalizedArtifactText(normalized);
}

export function createSafeArtifactPathSegment(value: string, fallback: string): string {
  const normalized = value.trim();
  if (safePathSegmentPattern.test(normalized) && normalized !== "." && normalized !== "..")
    return normalized;
  const prefix = normalized
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `${prefix.length > 0 ? prefix : fallback}-${digest}`;
}

function sanitizeNormalizedArtifactValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeNormalizedArtifactText(value);
  if (Array.isArray(value)) return value.map(sanitizeNormalizedArtifactValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSensitiveArtifactPropertyKey(key))
      .map(([key, child]) => [key, sanitizeArtifactProperty(key, child)]),
  );
}

function sanitizeNormalizedArtifactText(value: string): string {
  const sanitizedJson = sanitizeJsonArtifactText(value);
  if (sanitizedJson !== undefined) return sanitizedJson;
  return credentialPattern.test(value) ? redactedSensitiveContent : value;
}

function sanitizeArtifactProperty(key: string, value: unknown): unknown {
  if (errorKeyPattern.test(key) && typeof value === "string") return "execution failed";
  return sanitizeNormalizedArtifactValue(value);
}

function sanitizeJsonArtifactText(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed !== null && typeof parsed === "object")
      return JSON.stringify(sanitizeBenchmarkArtifactValue(parsed));
  } catch {}
  return undefined;
}

function classifyArtifactStringRole(propertyKey?: string): ArtifactStringRole {
  if (propertyKey === undefined) return "sequence";
  const normalized = normalizeArtifactKey(propertyKey);
  if (
    ["content", "credential", "data", "message", "output", "text", "value", "chunk"].includes(
      normalized,
    )
  )
    return "content";
  if (["header", "headers", "key", "label", "name", "role", "scheme", "type"].includes(normalized))
    return "descriptor";
  return "neutral";
}

function isSensitiveArtifactPropertyKey(key: string): boolean {
  const keyTokens = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return keyTokens.some(
    (token) =>
      token === "authorization" ||
      token === "cookie" ||
      token === "secret" ||
      token === "password" ||
      token === "credential" ||
      token === "private" ||
      token === "api" ||
      token === "key" ||
      token === "token",
  );
}

function normalizeArtifactKey(key: string): string {
  return key.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function redactStandaloneBasicCredentials(value: string): {
  readonly value: string;
  readonly continues: boolean;
} {
  let continues = false;
  const sanitized = value.replace(
    standaloneBasicTokenPattern,
    (match, boundary: string, prefix: string, token: string) => {
      if (!isCredentialShapedBasicToken(token)) return match;
      const tokenEnd = match.indexOf(token) + token.length;
      continues ||= value.endsWith(match) && tokenEnd === match.length;
      return `${boundary}${prefix}${redactedSensitiveContent}`;
    },
  );
  return { value: sanitized, continues };
}

function isCredentialShapedBasicToken(value: string): boolean {
  if (value.length < 12 || !/^[a-zA-Z0-9+/_.=-]+$/.test(value)) return false;
  return /[0-9+/_.=-]/.test(value) || (/[a-z]/.test(value) && /[A-Z]/.test(value));
}

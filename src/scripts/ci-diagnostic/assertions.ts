import { readFileSync } from "node:fs";

export type JsonRecord = Readonly<Record<string, unknown>>;

export class DiagnosticVerificationError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = "DiagnosticVerificationError";
    this.code = code;
  }
}

export function failVerification(code: string): never {
  throw new DiagnosticVerificationError(code);
}

export function requireCondition(condition: boolean, code: string): asserts condition {
  if (!condition) failVerification(code);
}

export function requireRecord(value: unknown, code: string): JsonRecord {
  requireCondition(typeof value === "object" && value !== null && !Array.isArray(value), code);
  return value as JsonRecord;
}

export function requireArray(value: unknown, code: string): readonly unknown[] {
  requireCondition(Array.isArray(value), code);
  return value;
}

export function requireString(value: unknown, code: string): string {
  requireCondition(typeof value === "string" && value.length > 0, code);
  return value;
}

export function requireInteger(value: unknown, code: string): number {
  requireCondition(typeof value === "number" && Number.isSafeInteger(value), code);
  return value;
}

export function requireFiniteNumber(value: unknown, code: string): number {
  requireCondition(typeof value === "number" && Number.isFinite(value), code);
  return value;
}

export function requireCanonicalTimestamp(value: unknown, code: string): string {
  const timestamp = requireString(value, code);
  const milliseconds = Date.parse(timestamp);
  requireCondition(
    Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === timestamp,
    code,
  );
  return timestamp;
}

export function readJsonRecord(path: string, code: string): JsonRecord {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return requireRecord(value, code);
  } catch (error) {
    if (error instanceof DiagnosticVerificationError) throw error;
    return failVerification(code);
  }
}

export function requireExactValue(actual: unknown, expected: unknown, code: string): void {
  requireCondition(Object.is(actual, expected), code);
}

export function requireExactKeys(
  record: JsonRecord,
  expected: readonly string[],
  code: string,
): void {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  requireCondition(
    actual.length === sortedExpected.length &&
      actual.every((key, index) => key === sortedExpected[index]),
    code,
  );
}

export function requireStringArray(value: unknown, code: string): readonly string[] {
  const entries = requireArray(value, code);
  requireCondition(
    entries.every((entry) => typeof entry === "string" && entry.length > 0),
    code,
  );
  return entries as readonly string[];
}

export function requireEqualStringArrays(
  actual: unknown,
  expected: readonly string[],
  code: string,
): void {
  const values = requireStringArray(actual, code);
  requireCondition(
    values.length === expected.length && values.every((value, index) => value === expected[index]),
    code,
  );
}

export function requireAbsent(record: JsonRecord, keys: readonly string[], code: string): void {
  requireCondition(
    keys.every((key) => !Object.hasOwn(record, key)),
    code,
  );
}

export function requireNull(record: JsonRecord, keys: readonly string[], code: string): void {
  requireCondition(
    keys.every((key) => Object.hasOwn(record, key) && record[key] === null),
    code,
  );
}

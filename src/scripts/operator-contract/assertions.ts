import { readFileSync } from "node:fs";

export function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new TypeError(code);
}

export function parseJsonRecord(text: string, code: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    requireCondition(typeof value === "object" && value !== null && !Array.isArray(value), code);
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof TypeError && error.message === code) throw error;
    throw new TypeError(code);
  }
}

export function readJsonRecord(path: string, code: string): Record<string, unknown> {
  return parseJsonRecord(readFileSync(path, "utf8"), code);
}

export function requireNoTerminalEscapes(text: string, code: string): void {
  requireCondition(!text.includes("\u001b"), code);
}

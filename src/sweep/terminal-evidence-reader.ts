import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { isRunEvidenceTemporaryName } from "./run-evidence.js";

export const terminalEvidenceConflictMessage =
  "Sweep terminal evidence is incompatible with the checkpoint";

export function failTerminalReconciliation(): never {
  throw new TypeError(terminalEvidenceConflictMessage);
}

export function readOperationalCost(result: Readonly<Record<string, unknown>>): number | undefined {
  if (typeof result.operationalCost !== "object" || result.operationalCost === null) {
    return undefined;
  }
  const value = result.operationalCost as Readonly<Record<string, unknown>>;
  return typeof value.amountUSD === "number" ? value.amountUSD : undefined;
}

export function readTerminalResult(
  resultPath: string,
  failurePath: string,
  expectedCompleted: boolean,
): Readonly<Record<string, unknown>> {
  const hasResult = existsSync(resultPath);
  const hasFailure = existsSync(failurePath);
  if (hasResult === hasFailure) failTerminalReconciliation();
  if (expectedCompleted && !hasResult) failTerminalReconciliation();
  const value = readRegularJson(hasResult ? resultPath : failurePath);
  if (value.artifactKind !== (hasResult ? "result" : "terminal-failure")) {
    failTerminalReconciliation();
  }
  return value;
}

export function readRegularJson(path: string): Readonly<Record<string, unknown>> {
  if (!existsSync(path)) failTerminalReconciliation();
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) failTerminalReconciliation();
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      failTerminalReconciliation();
    }
    return value as Readonly<Record<string, unknown>>;
  } catch {
    failTerminalReconciliation();
  }
}

export function containsNonTemporaryArtifact(runDirectory: string): boolean {
  if (!existsSync(runDirectory)) return false;
  const stats = lstatSync(runDirectory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) failTerminalReconciliation();
  for (const entry of readdirSync(runDirectory)) {
    if (!isRunEvidenceTemporaryName(entry)) return true;
    const temporaryStats = lstatSync(`${runDirectory}/${entry}`);
    if (!temporaryStats.isFile() || temporaryStats.isSymbolicLink()) failTerminalReconciliation();
  }
  return false;
}

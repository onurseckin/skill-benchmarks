import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DeterministicCheck, DeterministicCheckResult, GitDiffMetrics } from "./types.js";

interface ProcessExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface ExecutedDeterministicChecks {
  readonly checkResults: readonly DeterministicCheckResult[];
  readonly gitDiffMetrics?: GitDiffMetrics;
  readonly totalDurationMs: number;
}

const excludedScanDirectories = new Set(["node_modules", ".git", "dist", ".olt", ".benchmarks"]);

export class DeterministicCheckExecutor {
  public async execute(
    checks: readonly DeterministicCheck[],
    workspacePath: string,
  ): Promise<ExecutedDeterministicChecks> {
    const startTime = performance.now();
    const checkResults: DeterministicCheckResult[] = [];
    for (const check of checks) checkResults.push(await this.executeCheck(check, workspacePath));
    const gitDiffMetrics = checks.some((check) => check.type === "git_diff")
      ? await this.captureGitDiff(workspacePath)
      : undefined;
    return {
      checkResults,
      ...(gitDiffMetrics === undefined ? {} : { gitDiffMetrics }),
      totalDurationMs: Math.round(performance.now() - startTime),
    };
  }

  public async captureGitDiff(workspacePath: string): Promise<GitDiffMetrics> {
    await executeProcess("git add -N .", workspacePath, 15000);
    let diffResult = await executeProcess("git diff HEAD", workspacePath, 15000);
    if (diffResult.exitCode !== 0)
      diffResult = await executeProcess("git diff", workspacePath, 15000);
    let numstatResult = await executeProcess("git diff --numstat HEAD", workspacePath, 15000);
    if (numstatResult.exitCode !== 0)
      numstatResult = await executeProcess("git diff --numstat", workspacePath, 15000);
    const modifiedFiles: string[] = [];
    let insertions = 0;
    let deletions = 0;
    const lines = numstatResult.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) continue;
      const inserted = parts[0] === "-" ? 0 : parseInt(parts[0] ?? "0", 10) || 0;
      const deleted = parts[1] === "-" ? 0 : parseInt(parts[1] ?? "0", 10) || 0;
      const filePath = parts.slice(2).join(" ");
      insertions += inserted;
      deletions += deleted;
      if (filePath && !modifiedFiles.includes(filePath)) modifiedFiles.push(filePath);
    }
    return {
      filesChanged: modifiedFiles.length,
      insertions,
      deletions,
      rawDiff: diffResult.stdout,
      modifiedFiles,
    };
  }

  private async executeCheck(
    check: DeterministicCheck,
    workspacePath: string,
  ): Promise<DeterministicCheckResult> {
    const startTime = performance.now();
    const violations: string[] = [];
    let stdout: string | undefined;
    let stderr: string | undefined;
    let exitCode: number | undefined;
    let customScore: number | undefined;
    if (check.type === "command") {
      if (!check.command) violations.push("No command specified for command check");
      else {
        const result = await executeProcess(check.command, workspacePath);
        stdout = result.stdout;
        stderr = result.stderr;
        exitCode = result.exitCode;
        validateCommandResult(check, result, violations);
      }
    } else if (check.type === "file_content") validateFileContent(check, workspacePath, violations);
    else if (check.type === "file_exists") validateFileExistence(check, workspacePath, violations);
    else if (check.type === "git_diff")
      validateGitDiff(check, await this.captureGitDiff(workspacePath), violations);
    else if (check.type === "ast_pattern") validateAstPattern(check, workspacePath, violations);
    else if (check.type === "custom")
      customScore = await executeCustomCheck(check, workspacePath, violations);
    else {
      const exhaustiveType: never = check.type;
      violations.push(`Unsupported check type: ${String(exhaustiveType)}`);
    }
    const passed = violations.length === 0;
    const score = customScore === undefined ? (passed ? 1 : 0) : customScore;
    return {
      checkId: check.id,
      name: check.name,
      type: check.type,
      passed,
      score,
      weight: check.weight,
      weightedScore: score * check.weight,
      executionTimeMs: Math.round(performance.now() - startTime),
      ...(stdout === undefined ? {} : { stdout }),
      ...(stderr === undefined ? {} : { stderr }),
      ...(exitCode === undefined ? {} : { exitCode }),
      ...(violations.length === 0 ? {} : { errorDetails: violations.join("; "), violations }),
    };
  }
}

function executeProcess(
  command: string,
  cwd: string,
  timeoutMs = 60000,
): Promise<ProcessExecutionResult> {
  return new Promise((resolvePromise) => {
    const processHandle = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (result: ProcessExecutionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    timer = setTimeout(() => {
      timedOut = true;
      processHandle.kill("SIGKILL");
    }, timeoutMs);
    processHandle.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    processHandle.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    processHandle.on("error", (error: Error) =>
      finish({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: error.message,
        exitCode: 1,
      }),
    );
    processHandle.on("close", (code: number | null) =>
      finish({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: timedOut
          ? "Command execution timed out"
          : Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: timedOut ? 124 : (code ?? 0),
      }),
    );
  });
}

function validateCommandResult(
  check: DeterministicCheck,
  result: ProcessExecutionResult,
  violations: string[],
): void {
  const expectedExitCode = check.expectedExitCode ?? 0;
  if (result.exitCode !== expectedExitCode)
    violations.push(`Expected exit code ${expectedExitCode}, received ${result.exitCode}`);
  validatePattern(result.stdout, check.stdoutPattern, "Stdout", violations);
  validatePattern(result.stderr, check.stderrPattern, "Stderr", violations);
}

function validatePattern(
  value: string,
  pattern: string | undefined,
  label: string,
  violations: string[],
): void {
  if (pattern === undefined) return;
  try {
    if (!new RegExp(pattern, "m").test(value))
      violations.push(`${label} did not match pattern: ${pattern}`);
  } catch {
    violations.push(`Invalid ${label.toLowerCase()} pattern RegExp: ${pattern}`);
  }
}

function validateFileContent(
  check: DeterministicCheck,
  workspacePath: string,
  violations: string[],
): void {
  if (!check.filePath) {
    violations.push("No filePath specified for file_content check");
    return;
  }
  const fullPath = resolve(workspacePath, check.filePath);
  if (!existsSync(fullPath)) {
    violations.push(`File not found: ${check.filePath}`);
    return;
  }
  if (check.fileContentPattern === undefined) return;
  try {
    if (!new RegExp(check.fileContentPattern, "m").test(readFileSync(fullPath, "utf8")))
      violations.push(`File content did not match pattern: ${check.fileContentPattern}`);
  } catch {
    violations.push(`Failed reading or matching ${check.filePath}`);
  }
}

function validateFileExistence(
  check: DeterministicCheck,
  workspacePath: string,
  violations: string[],
): void {
  if (!check.filePath) {
    violations.push("No filePath specified for file_exists check");
    return;
  }
  const exists = existsSync(resolve(workspacePath, check.filePath));
  if ((check.mustExist ?? true) !== exists)
    violations.push(
      exists
        ? `Expected file not to exist: ${check.filePath}`
        : `Expected file to exist: ${check.filePath}`,
    );
}

function validateGitDiff(
  check: DeterministicCheck,
  metrics: GitDiffMetrics,
  violations: string[],
): void {
  for (const forbidden of check.forbiddenPaths ?? []) {
    const target = cleanPath(forbidden);
    const prefix = target.endsWith("/") ? target : `${target}/`;
    if (
      metrics.modifiedFiles.some(
        (file) => cleanPath(file) === target || cleanPath(file).startsWith(prefix),
      )
    )
      violations.push(`Forbidden path modified in git diff: ${forbidden}`);
  }
  if (check.maxFilesChanged !== undefined && metrics.filesChanged > check.maxFilesChanged)
    violations.push(
      `Files changed (${metrics.filesChanged}) exceeded maximum (${check.maxFilesChanged})`,
    );
  if (check.maxInsertions !== undefined && metrics.insertions > check.maxInsertions)
    violations.push(`Insertions (${metrics.insertions}) exceeded maximum (${check.maxInsertions})`);
  if (check.maxDeletions !== undefined && metrics.deletions > check.maxDeletions)
    violations.push(`Deletions (${metrics.deletions}) exceeded maximum (${check.maxDeletions})`);
}

function validateAstPattern(
  check: DeterministicCheck,
  workspacePath: string,
  violations: string[],
): void {
  if (!check.astPattern) {
    violations.push("No astPattern specified for ast_pattern check");
    return;
  }
  try {
    const pattern = new RegExp(check.astPattern, "m");
    if (check.filePath) {
      const fullPath = resolve(workspacePath, check.filePath);
      if (!existsSync(fullPath)) violations.push(`File not found: ${check.filePath}`);
      else if (!pattern.test(readFileSync(fullPath, "utf8")))
        violations.push(`AST pattern not found in ${check.filePath}: ${check.astPattern}`);
      return;
    }
    const matched = collectWorkspaceFiles(workspacePath).some((file) => {
      try {
        return pattern.test(readFileSync(file, "utf8"));
      } catch {
        return false;
      }
    });
    if (!matched) violations.push(`AST pattern not found in workspace: ${check.astPattern}`);
  } catch {
    violations.push(`Invalid AST pattern RegExp: ${check.astPattern}`);
  }
}

async function executeCustomCheck(
  check: DeterministicCheck,
  workspacePath: string,
  violations: string[],
): Promise<number | undefined> {
  if (!check.customValidator) {
    violations.push("No customValidator function provided for custom check");
    return undefined;
  }
  try {
    const result = await check.customValidator(workspacePath);
    if (!result.passed) violations.push(result.details ?? "Custom validator reported failure");
    return result.score;
  } catch {
    violations.push("Custom validator failed");
    return undefined;
  }
}

function collectWorkspaceFiles(directoryPath: string): readonly string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      if (excludedScanDirectories.has(entry.name)) continue;
      const fullPath = join(directoryPath, entry.name);
      if (entry.isDirectory()) files.push(...collectWorkspaceFiles(fullPath));
      else if (entry.isFile()) files.push(fullPath);
    }
  } catch {
    return files;
  }
  return files;
}

function cleanPath(filePath: string): string {
  if (filePath.startsWith("./")) return filePath.slice(2);
  if (filePath.startsWith("/")) return filePath.slice(1);
  return filePath;
}

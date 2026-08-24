import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  DeterministicCheck,
  DeterministicCheckResult,
  DeterministicSummary,
  GitDiffMetrics,
} from "./types.js";

interface ProcessExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const EXCLUDED_SCAN_DIRS = new Set(["node_modules", ".git", "dist", ".olt", ".benchmarks"]);

function cleanPath(filePath: string): string {
  if (filePath.startsWith("./")) {
    return filePath.slice(2);
  }
  if (filePath.startsWith("/")) {
    return filePath.slice(1);
  }
  return filePath;
}

function executeProcess(
  command: string,
  cwd: string,
  timeoutMs = 60000
): Promise<ProcessExecutionResult> {
  return new Promise((resolvePromise) => {
    const proc = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);
    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      resolvePromise({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: err.message,
        exitCode: 1,
      });
    });
    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolvePromise({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: timedOut ? "Command execution timed out" : Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: timedOut ? 124 : (code ?? 0),
      });
    });
  });
}

function collectWorkspaceFiles(dirPath: string): readonly string[] {
  const collected: string[] = [];
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (EXCLUDED_SCAN_DIRS.has(entry.name)) continue;
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        collected.push(...collectWorkspaceFiles(fullPath));
      } else if (entry.isFile()) {
        collected.push(fullPath);
      }
    }
  } catch {
    return collected;
  }
  return collected;
}

export class DeterministicVerificationEngine {
  async captureGitDiff(workspacePath: string): Promise<GitDiffMetrics> {
    await executeProcess("git add -N .", workspacePath, 15000);
    let diffRes = await executeProcess("git diff HEAD", workspacePath, 15000);
    if (diffRes.exitCode !== 0) {
      diffRes = await executeProcess("git diff", workspacePath, 15000);
    }
    let numstatRes = await executeProcess("git diff --numstat HEAD", workspacePath, 15000);
    if (numstatRes.exitCode !== 0) {
      numstatRes = await executeProcess("git diff --numstat", workspacePath, 15000);
    }
    const modifiedFiles: string[] = [];
    let insertions = 0;
    let deletions = 0;
    const lines = numstatRes.stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        const ins = parts[0] === "-" ? 0 : parseInt(parts[0] ?? "0", 10) || 0;
        const del = parts[1] === "-" ? 0 : parseInt(parts[1] ?? "0", 10) || 0;
        const filePath = parts.slice(2).join(" ");
        insertions += ins;
        deletions += del;
        if (filePath && !modifiedFiles.includes(filePath)) {
          modifiedFiles.push(filePath);
        }
      }
    }
    return {
      filesChanged: modifiedFiles.length,
      insertions,
      deletions,
      rawDiff: diffRes.stdout,
      modifiedFiles,
    };
  }

  async executeCheck(
    check: DeterministicCheck,
    workspacePath: string
  ): Promise<DeterministicCheckResult> {
    const startTime = performance.now();
    const violations: string[] = [];
    let stdout: string | undefined;
    let stderr: string | undefined;
    let exitCode: number | undefined;
    let customScore: number | undefined;

    switch (check.type) {
      case "command": {
        if (!check.command) {
          violations.push("No command specified for command check");
          break;
        }
        const cmdRes = await executeProcess(check.command, workspacePath);
        stdout = cmdRes.stdout;
        stderr = cmdRes.stderr;
        exitCode = cmdRes.exitCode;
        const expected = check.expectedExitCode ?? 0;
        if (exitCode !== expected) {
          violations.push(`Expected exit code ${expected}, received ${exitCode}`);
        }
        if (check.stdoutPattern) {
          try {
            if (!new RegExp(check.stdoutPattern, "m").test(stdout)) {
              violations.push(`Stdout did not match pattern: ${check.stdoutPattern}`);
            }
          } catch {
            violations.push(`Invalid stdout pattern RegExp: ${check.stdoutPattern}`);
          }
        }
        if (check.stderrPattern) {
          try {
            if (!new RegExp(check.stderrPattern, "m").test(stderr)) {
              violations.push(`Stderr did not match pattern: ${check.stderrPattern}`);
            }
          } catch {
            violations.push(`Invalid stderr pattern RegExp: ${check.stderrPattern}`);
          }
        }
        break;
      }

      case "file_content": {
        if (!check.filePath) {
          violations.push("No filePath specified for file_content check");
          break;
        }
        const fullPath = resolve(workspacePath, check.filePath);
        if (!existsSync(fullPath)) {
          violations.push(`File not found: ${check.filePath}`);
          break;
        }
        if (check.fileContentPattern) {
          try {
            const content = readFileSync(fullPath, "utf-8");
            if (!new RegExp(check.fileContentPattern, "m").test(content)) {
              violations.push(`File content did not match pattern: ${check.fileContentPattern}`);
            }
          } catch (err) {
            violations.push(`Failed reading ${check.filePath}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        break;
      }

      case "file_exists": {
        if (!check.filePath) {
          violations.push("No filePath specified for file_exists check");
          break;
        }
        const fullPath = resolve(workspacePath, check.filePath);
        const mustExist = check.mustExist ?? true;
        const exists = existsSync(fullPath);
        if (mustExist && !exists) {
          violations.push(`Expected file to exist: ${check.filePath}`);
        } else if (!mustExist && exists) {
          violations.push(`Expected file not to exist: ${check.filePath}`);
        }
        break;
      }

      case "git_diff": {
        const metrics = await this.captureGitDiff(workspacePath);
        if (check.forbiddenPaths && check.forbiddenPaths.length > 0) {
          for (const forbidden of check.forbiddenPaths) {
            const target = cleanPath(forbidden);
            const prefix = target.endsWith("/") ? target : `${target}/`;
            const hasForbidden = metrics.modifiedFiles.some((f) => {
              const cleaned = cleanPath(f);
              return cleaned === target || cleaned.startsWith(prefix);
            });
            if (hasForbidden) {
              violations.push(`Forbidden path modified in git diff: ${forbidden}`);
            }
          }
        }
        if (check.maxFilesChanged !== undefined && metrics.filesChanged > check.maxFilesChanged) {
          violations.push(`Files changed (${metrics.filesChanged}) exceeded maximum (${check.maxFilesChanged})`);
        }
        if (check.maxInsertions !== undefined && metrics.insertions > check.maxInsertions) {
          violations.push(`Insertions (${metrics.insertions}) exceeded maximum (${check.maxInsertions})`);
        }
        if (check.maxDeletions !== undefined && metrics.deletions > check.maxDeletions) {
          violations.push(`Deletions (${metrics.deletions}) exceeded maximum (${check.maxDeletions})`);
        }
        break;
      }

      case "ast_pattern": {
        if (!check.astPattern) {
          violations.push("No astPattern specified for ast_pattern check");
          break;
        }
        try {
          const regex = new RegExp(check.astPattern, "m");
          if (check.filePath) {
            const fullPath = resolve(workspacePath, check.filePath);
            if (!existsSync(fullPath)) {
              violations.push(`File not found: ${check.filePath}`);
            } else {
              const content = readFileSync(fullPath, "utf-8");
              if (!regex.test(content)) {
                violations.push(`AST pattern not found in ${check.filePath}: ${check.astPattern}`);
              }
            }
          } else {
            const files = collectWorkspaceFiles(workspacePath);
            const matched = files.some((f) => {
              try {
                return regex.test(readFileSync(f, "utf-8"));
              } catch {
                return false;
              }
            });
            if (!matched) {
              violations.push(`AST pattern not found in workspace: ${check.astPattern}`);
            }
          }
        } catch {
          violations.push(`Invalid AST pattern RegExp: ${check.astPattern}`);
        }
        break;
      }

      case "custom": {
        if (!check.customValidator) {
          violations.push("No customValidator function provided for custom check");
          break;
        }
        try {
          const customResult = await check.customValidator(workspacePath);
          if (!customResult.passed) {
            violations.push(customResult.details ?? "Custom validator reported failure");
          }
          if (customResult.score !== undefined) {
            customScore = customResult.score;
          }
        } catch (err) {
          violations.push(`Custom validator error: ${err instanceof Error ? err.message : String(err)}`);
        }
        break;
      }

      default: {
        const exhaustiveCheck: never = check.type;
        violations.push(`Unsupported check type: ${String(exhaustiveCheck)}`);
        break;
      }
    }

    const passed = violations.length === 0;
    const score = customScore !== undefined ? customScore : (passed ? 1 : 0);
    const weight = check.weight;
    const weightedScore = score * weight;
    const executionTimeMs = Math.round(performance.now() - startTime);

    return {
      checkId: check.id,
      name: check.name,
      type: check.type,
      passed,
      score,
      weight,
      weightedScore,
      executionTimeMs,
      stdout,
      stderr,
      exitCode,
      errorDetails: violations.length > 0 ? violations.join("; ") : undefined,
      violations: violations.length > 0 ? violations : undefined,
    };
  }

  async executeChecks(
    checks: readonly DeterministicCheck[],
    workspacePath: string
  ): Promise<DeterministicSummary> {
    const startTime = performance.now();
    const checkResults: DeterministicCheckResult[] = [];

    for (const check of checks) {
      const result = await this.executeCheck(check, workspacePath);
      checkResults.push(result);
    }

    const totalChecksCount = checks.length;
    const passedChecksCount = checkResults.filter((r) => r.passed).length;
    const allPassed = totalChecksCount === 0 || passedChecksCount === totalChecksCount;
    const rawScore = totalChecksCount > 0 ? (passedChecksCount / totalChecksCount) * 100 : 100;
    const totalWeight = checks.reduce((sum, check) => sum + (check.weight > 0 ? check.weight : 0), 0);
    const totalWeightedScore = checkResults.reduce((sum, result) => sum + result.weightedScore, 0);
    const weightedScore = totalWeight > 0 ? (totalWeightedScore / totalWeight) * 100 : (allPassed ? 100 : 0);

    const hasGitDiffCheck = checks.some((c) => c.type === "git_diff");
    let gitDiffMetrics: GitDiffMetrics | undefined;
    if (hasGitDiffCheck) {
      gitDiffMetrics = await this.captureGitDiff(workspacePath);
    }

    const totalDurationMs = Math.round(performance.now() - startTime);

    return {
      allPassed,
      passedChecksCount,
      totalChecksCount,
      rawScore,
      weightedScore,
      totalDurationMs,
      checkResults,
      gitDiffMetrics,
    };
  }
}

export async function runDeterministicVerification(
  checks: readonly DeterministicCheck[],
  workspacePath: string
): Promise<DeterministicSummary> {
  const engine = new DeterministicVerificationEngine();
  return engine.executeChecks(checks, workspacePath);
}

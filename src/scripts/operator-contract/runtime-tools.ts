import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StandardToolDispatcher } from "../../runner/tool-dispatcher.js";
import type { ExecutionLimits } from "../../runner/types.js";
import { requireCondition } from "./assertions.js";

export async function verifyToolProcessLifecycle(temporaryRoot: string): Promise<void> {
  await verifyCallerAbortStopsLocalProcess(temporaryRoot);
  await verifyRequestedTimeoutCannotExceedToolLimit(temporaryRoot);
}

async function verifyCallerAbortStopsLocalProcess(temporaryRoot: string): Promise<void> {
  const pidPath = join(temporaryRoot, "caller-abort.pid");
  const command = createDelayedNodeCommand(pidPath, 400);
  const controller = new AbortController();
  const startedAt = Date.now();
  const pending = dispatchCommand(temporaryRoot, command, createLimits(150), controller.signal);
  const abortTimer = setTimeout(() => controller.abort(new Error("fixture tool abort")), 50);
  const failure = await captureFailure(pending);
  clearTimeout(abortTimer);
  const childPid = readProcessId(pidPath);
  try {
    requireCondition(
      failure instanceof Error && failure.name === "ExecutionAbortedError",
      "tool_process_caller_abort_type",
    );
    requireCondition(Date.now() - startedAt < 250, "tool_process_caller_abort_bound");
    await delay(40);
    requireCondition(!isProcessAlive(childPid), "tool_process_caller_abort_teardown");
  } finally {
    stopProcess(childPid);
  }
}

async function verifyRequestedTimeoutCannotExceedToolLimit(
  temporaryRoot: string,
): Promise<void> {
  const pidPath = join(temporaryRoot, "tool-timeout.pid");
  const command = createDelayedNodeCommand(pidPath, 400);
  const startedAt = Date.now();
  const record = await dispatchCommand(
    temporaryRoot,
    command,
    createLimits(60),
    undefined,
    10,
  );
  const childPid = readProcessId(pidPath);
  try {
    requireCondition(record.isError, "tool_process_limit_error");
    requireCondition(Date.now() - startedAt < 250, "tool_process_limit_bound");
    await delay(40);
    requireCondition(!isProcessAlive(childPid), "tool_process_limit_teardown");
  } finally {
    stopProcess(childPid);
  }
}

async function dispatchCommand(
  workspaceRoot: string,
  command: string,
  limits: ExecutionLimits,
  signal?: AbortSignal,
  timeoutSeconds?: number,
) {
  return await new StandardToolDispatcher().dispatch(
    {
      id: "fixture-command",
      name: "run_command",
      arguments: {
        command,
        ...(timeoutSeconds === undefined ? {} : { timeout_seconds: timeoutSeconds }),
      },
      rawArguments: "{}",
    },
    {
      workspace: { rootPath: workspaceRoot },
      signal,
      runId: "fixture-run",
      scenarioId: "fixture-scenario",
    },
    limits,
  );
}

function createDelayedNodeCommand(pidPath: string, delayMs: number): string {
  const script = `const fs=require("node:fs");fs.writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setTimeout(()=>process.exit(0),${delayMs})`;
  return `${quoteShell(process.execPath)} -e ${quoteShell(script)}`;
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function createLimits(toolTimeoutMs: number): ExecutionLimits {
  return {
    maxTurns: 1,
    maxWallClockTimeMs: 500,
    maxCostUSD: 1,
    maxConsecutiveToolFailures: 1,
    toolTimeoutMs,
    maxOutputSizeBytes: 1024,
  };
}

function readProcessId(path: string): number | undefined {
  if (!existsSync(path)) return undefined;
  const value = Number(readFileSync(path, "utf8"));
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function isProcessAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopProcess(pid: number | undefined): void {
  if (pid === undefined || !isProcessAlive(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

async function captureFailure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

async function delay(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

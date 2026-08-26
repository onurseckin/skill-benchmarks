import { spawn, type ChildProcess } from "node:child_process";
import { resolveAbortReason } from "../shared/cancellation.js";

export interface LocalCommandExecutionInput {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly environment: Readonly<Record<string, string>>;
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal;
}

export interface LocalCommandExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly outputTruncated: boolean;
}

export async function executeLocalCommand(
  input: LocalCommandExecutionInput,
): Promise<LocalCommandExecutionResult> {
  if (input.signal?.aborted === true) throw resolveAbortReason(input.signal, "tool");
  const detached = process.platform !== "win32";
  const child = spawn(input.command, {
    cwd: input.cwd,
    shell: true,
    env: input.environment,
    detached,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = createBoundedOutputCollector(input.maxOutputBytes);
  child.stdout?.on("data", (chunk: Buffer | string) => output.appendStdout(chunk));
  child.stderr?.on("data", (chunk: Buffer | string) => output.appendStderr(chunk));

  let timedOut = false;
  let abortError: Error | undefined;
  let spawnError: Error | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const terminate = (): void => {
    terminateChild(child, detached, "SIGTERM");
    killTimer ??= setTimeout(() => terminateChild(child, detached, "SIGKILL"), 100);
  };
  const abortListener = (): void => {
    abortError = resolveAbortReason(input.signal, "tool");
    terminate();
  };
  input.signal?.addEventListener("abort", abortListener, { once: true });
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, input.timeoutMs);

  const exitCode = await new Promise<number>((resolve) => {
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code) => resolve(code ?? 1));
  }).finally(() => {
    clearTimeout(timeoutTimer);
    if (killTimer !== undefined) clearTimeout(killTimer);
    input.signal?.removeEventListener("abort", abortListener);
  });

  if (abortError !== undefined) throw abortError;
  const captured = output.finish();
  return {
    stdout: captured.stdout,
    stderr:
      spawnError === undefined
        ? captured.stderr
        : [captured.stderr, spawnError.message].filter((value) => value.length > 0).join("\n"),
    exitCode,
    timedOut,
    outputTruncated: captured.truncated,
  };
}

function terminateChild(child: ChildProcess, detached: boolean, signal: NodeJS.Signals): void {
  try {
    if (detached && child.pid !== undefined) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

function createBoundedOutputCollector(maxOutputBytes: number) {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const capacity = Math.max(0, Math.floor(maxOutputBytes));
  let capturedBytes = 0;
  let truncated = false;
  const append = (target: Buffer[], chunk: Buffer | string): void => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = Math.max(0, capacity - capturedBytes);
    if (bytes.byteLength > remaining) truncated = true;
    if (remaining === 0) return;
    const captured = bytes.subarray(0, remaining);
    target.push(captured);
    capturedBytes += captured.byteLength;
  };
  return {
    appendStdout: (chunk: Buffer | string): void => append(stdoutChunks, chunk),
    appendStderr: (chunk: Buffer | string): void => append(stderrChunks, chunk),
    finish: () => ({
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
      truncated,
    }),
  };
}

export function resolveToolTimeoutMs(
  configuredTimeoutMs: number | undefined,
  requestedTimeoutSeconds?: number,
): number {
  const configured = configuredTimeoutMs ?? 60_000;
  if (!Number.isFinite(configured) || configured <= 0) {
    throw new TypeError("Tool timeout must be a positive finite number");
  }
  const limit = Math.max(1, Math.floor(configured));
  if (requestedTimeoutSeconds === undefined) return limit;
  if (!Number.isFinite(requestedTimeoutSeconds) || requestedTimeoutSeconds <= 0) {
    throw new TypeError("Requested tool timeout must be a positive finite number");
  }
  return Math.max(1, Math.min(limit, Math.floor(requestedTimeoutSeconds * 1000)));
}

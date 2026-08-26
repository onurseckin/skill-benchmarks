import { basename } from "node:path";
import { requireCondition } from "./assertions.js";
import { credentialKeys } from "./fixture.js";

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
}

export interface RunningCommand {
  readonly exit: Promise<number>;
  readonly stdout: Promise<string>;
  readonly stderr: Promise<string>;
  readonly kill: (signal: NodeJS.Signals) => void;
  readonly signalLeader: (signal: NodeJS.Signals) => void;
  readonly isGroupAlive: () => boolean;
  readonly cancelOutput: () => Promise<void>;
}

interface OutputDrain {
  readonly output: Promise<string>;
  readonly cancel: () => Promise<void>;
}

const finalizationTimeoutMs = 1_000;

export async function runCommand(
  argumentsList: readonly string[],
  options: CommandOptions,
): Promise<CommandResult> {
  const running = startCommand(argumentsList, options);
  const exitCode = await waitForExit(running, options.timeoutMs ?? 60_000);
  if (exitCode === undefined) {
    const timeoutFailure = new TypeError(`command_timeout:${argumentsList.join(" ")}`);
    await stopAfterFailure(running, timeoutFailure);
    throw timeoutFailure;
  }
  if (running.isGroupAlive()) {
    running.kill("SIGKILL");
    await requireGroupStopped(running, finalizationTimeoutMs);
  }
  const [stdout, stderr] = await readOutput(running, finalizationTimeoutMs);
  return { exitCode, stdout, stderr };
}

export async function runSuccessfulCommand(
  argumentsList: readonly string[],
  options: CommandOptions,
  code: string,
): Promise<CommandResult> {
  const result = await runCommand(argumentsList, options);
  requireCondition(result.exitCode === 0, `${code}:${result.stderr.trim()}`);
  return result;
}

export function startCommand(
  argumentsList: readonly string[],
  options: CommandOptions,
): RunningCommand {
  const securedArguments = secureBunArguments(argumentsList);
  const child = Bun.spawn(securedArguments, {
    cwd: options.cwd,
    detached: true,
    env: stripCredentialKeys(options.env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = drainStream(child.stdout);
  const stderr = drainStream(child.stderr);
  return {
    exit: child.exited,
    stdout: stdout.output,
    stderr: stderr.output,
    kill: (signal) => signalProcessGroup(child.pid, signal),
    signalLeader: (signal) => signalProcess(child.pid, signal),
    isGroupAlive: () => isProcessGroupAlive(child.pid),
    cancelOutput: async () => {
      await Promise.allSettled([stdout.cancel(), stderr.cancel()]);
    },
  };
}

function stripCredentialKeys(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const secured = Object.fromEntries(
    Object.entries(environment).filter(([key]) => !credentialKeys.has(key)),
  );
  secured.BUN_OPTIONS = "--no-env-file";
  return secured;
}

export async function terminateCommand(
  running: RunningCommand,
  signal: NodeJS.Signals,
  timeoutMs: number,
): Promise<CommandResult> {
  running.signalLeader(signal);
  let exitCode = await waitForExit(running, timeoutMs);
  if (exitCode === undefined || running.isGroupAlive()) {
    running.kill("SIGKILL");
    exitCode ??= await waitForExit(running, finalizationTimeoutMs);
  }
  requireCondition(exitCode !== undefined, "command_exit_timeout");
  await requireGroupStopped(running, finalizationTimeoutMs);
  const [stdout, stderr] = await readOutput(running, finalizationTimeoutMs);
  return { exitCode, stdout, stderr };
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function secureBunArguments(argumentsList: readonly string[]): string[] {
  const executable = argumentsList[0];
  requireCondition(executable !== undefined, "command_missing_executable");
  const bunExecutable = executable === process.execPath || basename(executable) === "bun";
  if (!bunExecutable) return [...argumentsList];
  requireCondition(
    !argumentsList
      .slice(1)
      .some((value) => value === "--env-file" || value.startsWith("--env-file=")),
    "command_env_file_forbidden",
  );
  if (argumentsList[1] === "--no-env-file") return [...argumentsList];
  return [executable, "--no-env-file", ...argumentsList.slice(1)];
}

function drainStream(stream: ReadableStream<Uint8Array>): OutputDrain {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let cancelled = false;
  const output = (async () => {
    let text = "";
    while (true) {
      const result = await reader.read();
      if (result.done) return text + decoder.decode();
      text += decoder.decode(result.value, { stream: true });
    }
  })();
  return {
    output,
    cancel: async () => {
      if (cancelled) return;
      cancelled = true;
      await reader.cancel();
    },
  };
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function isProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

async function waitForExit(
  running: RunningCommand,
  timeoutMs: number,
): Promise<number | undefined> {
  return await new Promise<number | undefined>((resolveWait, rejectWait) => {
    const timeout = setTimeout(() => resolveWait(undefined), timeoutMs);
    void running.exit.then(
      (code) => {
        clearTimeout(timeout);
        resolveWait(code);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        rejectWait(error);
      },
    );
  });
}

async function requireGroupStopped(running: RunningCommand, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (running.isGroupAlive() && Date.now() < deadline) await Bun.sleep(20);
  requireCondition(!running.isGroupAlive(), "command_group_survived");
}

async function readOutput(running: RunningCommand, timeoutMs: number): Promise<[string, string]> {
  const result = await withDeadline(Promise.all([running.stdout, running.stderr]), timeoutMs);
  if (result !== undefined) return result;
  await running.cancelOutput();
  throw new TypeError("command_output_timeout");
}

async function stopAfterFailure(running: RunningCommand, primaryFailure: Error): Promise<void> {
  try {
    running.kill("SIGKILL");
    await requireGroupStopped(running, finalizationTimeoutMs);
    await running.cancelOutput();
  } catch (cleanupFailure) {
    throw new AggregateError([primaryFailure, cleanupFailure], "command_cleanup_failed");
  }
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return await new Promise<T | undefined>((resolveWait, rejectWait) => {
    const timeout = setTimeout(() => resolveWait(undefined), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolveWait(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        rejectWait(error);
      },
    );
  });
}

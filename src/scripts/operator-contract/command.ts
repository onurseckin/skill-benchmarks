import { requireCondition } from "./assertions.js";

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
}

export async function runCommand(
  argumentsList: readonly string[],
  options: CommandOptions,
): Promise<CommandResult> {
  const running = startCommand(argumentsList, options);
  const timeoutMs = options.timeoutMs ?? 60_000;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  timeout = setTimeout(() => {
    timedOut = true;
    running.kill("SIGKILL");
  }, timeoutMs);
  try {
    const exitCode = await running.exit;
    const [stdout, stderr] = await Promise.all([running.stdout, running.stderr]);
    if (timedOut) throw new TypeError(`command_timeout:${argumentsList.join(" ")}`);
    return { exitCode, stdout, stderr };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
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
  const child = Bun.spawn([...argumentsList], {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let settled = false;
  const exit = child.exited.then((code) => {
    settled = true;
    return code;
  });
  return {
    exit,
    stdout: new Response(child.stdout).text(),
    stderr: new Response(child.stderr).text(),
    kill: (signal) => {
      if (!settled) child.kill(signal);
    },
  };
}

export async function terminateCommand(
  running: RunningCommand,
  signal: NodeJS.Signals,
  timeoutMs: number,
): Promise<CommandResult> {
  running.kill(signal);
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
    escalation = setTimeout(() => running.kill("SIGKILL"), timeoutMs);
    void running.exit.then(resolveExit, rejectExit);
  });
  if (escalation !== undefined) clearTimeout(escalation);
  const [stdout, stderr] = await Promise.all([running.stdout, running.stderr]);
  return { exitCode, stdout, stderr };
}

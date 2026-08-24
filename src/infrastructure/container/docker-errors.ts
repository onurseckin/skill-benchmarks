export class DockerError extends Error {
  readonly command: ReadonlyArray<string>;
  readonly exitCode: number;
  readonly stderr: string;

  constructor(command: ReadonlyArray<string>, exitCode: number, stderr: string, message?: string) {
    const formattedCmd = command.join(" ");
    super(message ?? `Docker command '${formattedCmd}' failed with exit code ${exitCode}: ${stderr}`);
    this.name = "DockerError";
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export class DockerTimeoutError extends DockerError {
  readonly timeoutMs: number;

  constructor(command: ReadonlyArray<string>, timeoutMs: number, stderr: string = "") {
    super(command, 124, stderr, `Docker command '${command.join(" ")}' timed out after ${timeoutMs}ms`);
    this.name = "DockerTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

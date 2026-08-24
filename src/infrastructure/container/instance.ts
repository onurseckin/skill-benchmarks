import { ContainerStateMachine } from "./state-machine.js";
import type {
  ContainerExecResult,
  ContainerLaunchConfig,
  ContainerState,
  ExecuteCommandOptions,
  IContainerInstance,
  IDockerClient,
} from "./types.js";

const META_TRAILER_REGEX = /\n?__SB_META_TRAILER__:(\{.*?\})\n?$/;

interface MetaTrailer {
  readonly exitCode: number;
  readonly durationMs: number;
}

export class ContainerInstance implements IContainerInstance {
  readonly containerId: string;
  readonly runId: string;
  readonly config: ContainerLaunchConfig;
  readonly stateMachine: ContainerStateMachine;
  private readonly dockerClient: IDockerClient;

  constructor(
    containerId: string,
    config: ContainerLaunchConfig,
    dockerClient: IDockerClient,
    stateMachine?: ContainerStateMachine
  ) {
    this.containerId = containerId;
    this.runId = config.runId;
    this.config = config;
    this.dockerClient = dockerClient;
    this.stateMachine = stateMachine ?? new ContainerStateMachine("READY");
  }

  get state(): ContainerState {
    return this.stateMachine.state;
  }

  private parseTrailer(rawStderr: string): { readonly cleanStderr: string; readonly trailer?: MetaTrailer } {
    const match = META_TRAILER_REGEX.exec(rawStderr);
    if (!match || !match[1]) {
      return { cleanStderr: rawStderr, trailer: undefined };
    }

    try {
      const parsed = JSON.parse(match[1]) as { exitCode?: unknown; durationMs?: unknown };
      if (typeof parsed.exitCode === "number" && typeof parsed.durationMs === "number") {
        const cleanStderr = rawStderr.replace(META_TRAILER_REGEX, "").trimEnd();
        return {
          cleanStderr,
          trailer: {
            exitCode: parsed.exitCode,
            durationMs: parsed.durationMs,
          },
        };
      }
    } catch {
    }

    return { cleanStderr: rawStderr, trailer: undefined };
  }

  async executeCommand(
    command: string,
    options?: ExecuteCommandOptions
  ): Promise<ContainerExecResult> {
    if (this.stateMachine.state !== "EXECUTING") {
      this.stateMachine.transition("EXECUTING");
    }

    const cwd = options?.cwd ?? "/workspace";
    const timeoutMs = options?.timeoutMs ?? this.config.timeouts.commandTimeoutMs;
    const user = options?.user ?? this.config.user ?? "sandbox";

    const wrappedScript = `
set -o pipefail
CWD="${cwd}"
cd "\${CWD}" || exit 1
START_NS=$(date +%s%N)
${command}
EXIT_CODE=$?
END_NS=$(date +%s%N)
DURATION_MS=$(( (END_NS - START_NS) / 1000000 ))
printf "\\n__SB_META_TRAILER__:{\\"exitCode\\":%d,\\\"durationMs\\\":%d}\\n" "\${EXIT_CODE}" "\${DURATION_MS}" >&2
exit \${EXIT_CODE}
`.trim();

    const execArgs = ["/bin/bash", "-c", wrappedScript];

    let execResult;
    try {
      execResult = await this.dockerClient.exec(this.containerId, execArgs, {
        cwd,
        user,
        env: options?.env ?? this.config.environment,
        timeoutMs,
        onStdoutChunk: options?.onStdoutChunk,
        onStderrChunk: options?.onStderrChunk,
      });
    } catch (err) {
      if (this.stateMachine.canTransition("ERRORED")) {
        this.stateMachine.transition("ERRORED", (err as Error).message);
      }
      throw err;
    }

    const rawStdout = new TextDecoder().decode(execResult.stdout);
    const rawStderr = new TextDecoder().decode(execResult.stderr);

    const { cleanStderr, trailer } = this.parseTrailer(rawStderr);

    const exitCode = execResult.timedOut ? 124 : (trailer?.exitCode ?? execResult.exitCode);
    const executionTimeMs = trailer?.durationMs ?? execResult.durationMs;
    const timedOut = execResult.timedOut;
    const oomKilled = exitCode === 137;

    let peakMemoryBytes = 0;
    try {
      const inspectInfo = await this.dockerClient.inspectContainer(this.containerId);
      if (inspectInfo.state.oomKilled) {
      }
    } catch {
    }

    if (this.stateMachine.state === "EXECUTING") {
      this.stateMachine.transition("READY");
    }

    return {
      exitCode,
      stdout: rawStdout,
      stderr: cleanStderr,
      executionTimeMs,
      peakMemoryBytes,
      timedOut,
      oomKilled,
    };
  }

  async readFile(path: string): Promise<Uint8Array> {
    const result = await this.dockerClient.exec(
      this.containerId,
      ["/bin/bash", "-c", `base64 "${path}"`],
      {
        cwd: "/workspace",
        user: "root",
      }
    );

    if (result.exitCode !== 0) {
      const errText = new TextDecoder().decode(result.stderr);
      throw new Error(`Failed to read file '${path}' in container ${this.containerId}: ${errText}`);
    }

    const base64Str = new TextDecoder().decode(result.stdout).replace(/\s+/g, "");
    const binaryStr = atob(base64Str);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
  }

  async writeFile(path: string, content: Uint8Array | string): Promise<void> {
    let base64Content: string;
    if (typeof content === "string") {
      const encoded = new TextEncoder().encode(content);
      let binary = "";
      for (let i = 0; i < encoded.length; i++) {
        binary += String.fromCharCode(encoded[i] ?? 0);
      }
      base64Content = btoa(binary);
    } else {
      let binary = "";
      for (let i = 0; i < content.length; i++) {
        binary += String.fromCharCode(content[i] ?? 0);
      }
      base64Content = btoa(binary);
    }

    const script = `
DIRNAME=$(dirname "${path}")
mkdir -p "$DIRNAME"
printf "%s" "${base64Content}" | base64 -d > "${path}"
`.trim();

    const result = await this.dockerClient.exec(
      this.containerId,
      ["/bin/bash", "-c", script],
      {
        cwd: "/workspace",
        user: "root",
      }
    );

    if (result.exitCode !== 0) {
      const errText = new TextDecoder().decode(result.stderr);
      throw new Error(`Failed to write file '${path}' in container ${this.containerId}: ${errText}`);
    }
  }

  async extractGitDiff(): Promise<string> {
    if (this.stateMachine.state !== "EXTRACTING") {
      this.stateMachine.transition("EXTRACTING");
    }

    const script = `
cd /workspace || exit 1
git add --intent-to-add . 2>/dev/null || true
git diff --binary --full-index baseline 2>/dev/null || git diff --binary --full-index HEAD 2>/dev/null || true
`.trim();

    const result = await this.dockerClient.exec(
      this.containerId,
      ["/bin/bash", "-c", script],
      {
        cwd: "/workspace",
        user: "sandbox",
      }
    );

    const diffOutput = new TextDecoder().decode(result.stdout);

    if (this.stateMachine.state === "EXTRACTING") {
      this.stateMachine.transition("READY");
    }

    return diffOutput;
  }

  async teardown(): Promise<void> {
    if (this.stateMachine.state === "TERMINATED") {
      return;
    }

    if (this.stateMachine.canTransition("TEARDOWN")) {
      this.stateMachine.transition("TEARDOWN");
    }

    try {
      await this.dockerClient.killContainer(this.containerId);
    } catch {
    }

    try {
      await this.dockerClient.removeContainer(this.containerId, {
        force: true,
        removeVolumes: true,
      });
    } catch {
    }

    try {
      if (this.config.workspaceVolumeName) {
        await this.dockerClient.removeVolume(this.config.workspaceVolumeName, {
          force: true,
        });
      }
    } catch {
    }

    if (this.stateMachine.canTransition("TERMINATED")) {
      this.stateMachine.transition("TERMINATED");
    }
  }
}

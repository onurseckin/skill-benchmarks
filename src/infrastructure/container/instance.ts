import { ContainerCleanupError } from "./pool-errors.js";
import { ContainerStateMachine } from "./state-machine.js";
import type {
  ContainerExecResult,
  ContainerLaunchConfig,
  ContainerState,
  ExecuteCommandOptions,
  IContainerInstance,
  IDockerClient,
} from "./types.js";

const metaTrailerExpression = /\n?__SB_META_TRAILER__:(\{.*?\})\n?$/;

interface MetaTrailer {
  readonly exitCode: number;
  readonly durationMs: number;
}

export class ContainerInstance implements IContainerInstance {
  public readonly containerId: string;
  public readonly runId: string;
  public readonly config: ContainerLaunchConfig;
  public readonly stateMachine: ContainerStateMachine;
  private readonly dockerClient: IDockerClient;
  private teardownPromise: Promise<void> | undefined;
  private containerRemoved = false;
  private volumeRemoved = false;

  public constructor(
    containerId: string,
    config: ContainerLaunchConfig,
    dockerClient: IDockerClient,
    stateMachine?: ContainerStateMachine,
  ) {
    this.containerId = containerId;
    this.runId = config.runId;
    this.config = config;
    this.dockerClient = dockerClient;
    this.stateMachine = stateMachine ?? new ContainerStateMachine("READY");
  }

  public get state(): ContainerState {
    return this.stateMachine.state;
  }

  public async executeCommand(
    command: string,
    options?: ExecuteCommandOptions,
  ): Promise<ContainerExecResult> {
    if (this.stateMachine.state !== "EXECUTING") this.stateMachine.transition("EXECUTING");
    const cwd = options?.cwd ?? "/workspace";
    const timeoutMs = options?.timeoutMs ?? this.config.timeouts.commandTimeoutMs;
    const user = options?.user ?? this.config.user ?? "sandbox";
    const wrappedScript = [
      "set -o pipefail",
      `CWD="${cwd}"`,
      'cd "${CWD}" || exit 1',
      "START_NS=$(date +%s%N)",
      command,
      "EXIT_CODE=$?",
      "END_NS=$(date +%s%N)",
      "DURATION_MS=$(( (END_NS - START_NS) / 1000000 ))",
      'printf "\\n__SB_META_TRAILER__:{\\"exitCode\\":%d,\\"durationMs\\":%d}\\n" "${EXIT_CODE}" "${DURATION_MS}" >&2',
      "exit ${EXIT_CODE}",
    ].join("\n");
    let execution;
    try {
      execution = await this.dockerClient.exec(
        this.containerId,
        ["/bin/bash", "-c", wrappedScript],
        {
          cwd,
          user,
          env: options?.env ?? this.config.environment,
          timeoutMs,
          onStdoutChunk: options?.onStdoutChunk,
          onStderrChunk: options?.onStderrChunk,
        },
      );
    } catch (error) {
      if (this.stateMachine.canTransition("ERRORED")) {
        this.stateMachine.transition("ERRORED", asError(error).message);
      }
      throw error;
    }
    const stderr = new TextDecoder().decode(execution.stderr);
    const trailer = parseTrailer(stderr);
    if (this.stateMachine.state === "EXECUTING") this.stateMachine.transition("READY");
    return {
      exitCode: execution.timedOut ? 124 : (trailer.value?.exitCode ?? execution.exitCode),
      stdout: new TextDecoder().decode(execution.stdout),
      stderr: trailer.stderr,
      executionTimeMs: trailer.value?.durationMs ?? execution.durationMs,
      peakMemoryBytes: 0,
      timedOut: execution.timedOut,
      oomKilled: execution.exitCode === 137,
    };
  }

  public async readFile(path: string): Promise<Uint8Array> {
    const result = await this.dockerClient.exec(
      this.containerId,
      ["/bin/bash", "-c", `base64 "${path}"`],
      { cwd: "/workspace", user: "root" },
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read file '${path}' in container ${this.containerId}`);
    }
    const content = atob(new TextDecoder().decode(result.stdout).replace(/\s+/g, ""));
    return Uint8Array.from(content, (character) => character.charCodeAt(0));
  }

  public async writeFile(path: string, content: Uint8Array | string): Promise<void> {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const encoded = encodeBase64(bytes);
    const script = `DIRNAME=$(dirname "${path}")\nmkdir -p "$DIRNAME"\nprintf "%s" "${encoded}" | base64 -d > "${path}"`;
    const result = await this.dockerClient.exec(this.containerId, ["/bin/bash", "-c", script], {
      cwd: "/workspace",
      user: "root",
    });
    if (result.exitCode !== 0) {
      throw new Error(`Failed to write file '${path}' in container ${this.containerId}`);
    }
  }

  public async extractGitDiff(): Promise<string> {
    if (this.stateMachine.state !== "EXTRACTING") this.stateMachine.transition("EXTRACTING");
    const script = [
      "cd /workspace || exit 1",
      "git add --intent-to-add . 2>/dev/null || true",
      "git diff --binary --full-index baseline 2>/dev/null || git diff --binary --full-index HEAD 2>/dev/null || true",
    ].join("\n");
    const result = await this.dockerClient.exec(this.containerId, ["/bin/bash", "-c", script], {
      cwd: "/workspace",
      user: "sandbox",
    });
    if (this.stateMachine.state === "EXTRACTING") this.stateMachine.transition("READY");
    return new TextDecoder().decode(result.stdout);
  }

  public teardown(): Promise<void> {
    if (this.stateMachine.state === "TERMINATED") return Promise.resolve();
    if (this.teardownPromise !== undefined) return this.teardownPromise;
    const attempt = this.performTeardown();
    this.teardownPromise = attempt;
    void attempt.then(
      () => {
        this.teardownPromise = undefined;
      },
      () => {
        this.teardownPromise = undefined;
      },
    );
    return attempt;
  }

  private async performTeardown(): Promise<void> {
    if (this.stateMachine.canTransition("TEARDOWN")) this.stateMachine.transition("TEARDOWN");
    const errors: Error[] = [];
    if (!this.containerRemoved) {
      await this.killContainer();
      try {
        await this.dockerClient.removeContainer(this.containerId, {
          force: true,
          removeVolumes: true,
        });
        this.containerRemoved = true;
      } catch (error) {
        errors.push(asError(error));
      }
    }
    if (!this.volumeRemoved && this.config.workspaceVolumeName.length > 0) {
      try {
        await this.dockerClient.removeVolume(this.config.workspaceVolumeName, { force: true });
        this.volumeRemoved = true;
      } catch (error) {
        errors.push(asError(error));
      }
    } else if (this.config.workspaceVolumeName.length === 0) {
      this.volumeRemoved = true;
    }
    if (errors.length > 0) {
      if (this.stateMachine.canTransition("ERRORED")) this.stateMachine.transition("ERRORED");
      throw new ContainerCleanupError(
        "Container teardown did not remove every owned resource",
        errors,
      );
    }
    if (this.stateMachine.canTransition("TERMINATED")) this.stateMachine.transition("TERMINATED");
  }

  private async killContainer(): Promise<void> {
    try {
      await this.dockerClient.killContainer(this.containerId);
    } catch {}
  }
}

function parseTrailer(rawStderr: string): {
  readonly stderr: string;
  readonly value?: MetaTrailer;
} {
  const match = metaTrailerExpression.exec(rawStderr);
  if (match?.[1] === undefined) return { stderr: rawStderr };
  try {
    const parsed = JSON.parse(match[1]) as { exitCode?: unknown; durationMs?: unknown };
    if (typeof parsed.exitCode !== "number" || typeof parsed.durationMs !== "number") {
      return { stderr: rawStderr };
    }
    return {
      stderr: rawStderr.replace(metaTrailerExpression, "").trimEnd(),
      value: { exitCode: parsed.exitCode, durationMs: parsed.durationMs },
    };
  } catch {
    return { stderr: rawStderr };
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary);
}

import {
  buildCreateContainerArgs,
  buildExecArgs,
  buildListContainersArgs,
  buildListVolumesArgs,
  type RawDockerInspectItem,
  type RawDockerVolumeInspectItem,
} from "./docker-args.js";
import { DockerError, DockerTimeoutError } from "./docker-errors.js";
import type {
  ContainerInspectInfo,
  ContainerInspectState,
  DockerCreateOptions,
  DockerExecOptions,
  DockerExecProcessResult,
  IDockerClient,
  VolumeInspectInfo,
} from "./types.js";

export { DockerError, DockerTimeoutError };

function concatUint8Arrays(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export class DockerClient implements IDockerClient {
  private readonly dockerBinary: string;

  constructor(dockerBinary: string = "docker") {
    this.dockerBinary = dockerBinary;
  }

  private async runSubprocess(
    args: ReadonlyArray<string>,
    options?: {
      readonly timeoutMs?: number;
      readonly onStdoutChunk?: (chunk: Uint8Array) => void;
      readonly onStderrChunk?: (chunk: Uint8Array) => void;
    },
  ): Promise<DockerExecProcessResult> {
    const fullCommand = [this.dockerBinary, ...args];
    const startTime = Date.now();

    const proc = Bun.spawn(fullCommand as string[], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];

    const stdoutPromise = (async () => {
      if (proc.stdout && typeof proc.stdout !== "number") {
        const reader = proc.stdout.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              stdoutChunks.push(value);
              options?.onStdoutChunk?.(value);
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
    })();

    const stderrPromise = (async () => {
      if (proc.stderr && typeof proc.stderr !== "number") {
        const reader = proc.stderr.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              stderrChunks.push(value);
              options?.onStderrChunk?.(value);
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
    })();

    let timedOut = false;
    let timerId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<number>((resolve) => {
      if (options?.timeoutMs !== undefined && options.timeoutMs > 0) {
        timerId = setTimeout(() => {
          timedOut = true;
          try {
            proc.kill(9);
          } catch {}
          resolve(124);
        }, options.timeoutMs);
      }
    });

    const exitCodePromise = proc.exited;
    const exitCode = await Promise.race([exitCodePromise, timeoutPromise]);
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }

    await Promise.all([stdoutPromise, stderrPromise]);

    const durationMs = Date.now() - startTime;
    const stdout = concatUint8Arrays(stdoutChunks);
    const stderr = concatUint8Arrays(stderrChunks);

    return {
      exitCode,
      stdout,
      stderr,
      durationMs,
      timedOut,
    };
  }

  async createContainer(options: DockerCreateOptions): Promise<string> {
    const args = buildCreateContainerArgs(options);
    const result = await this.runSubprocess(args);
    if (result.exitCode !== 0) {
      const stderrStr = new TextDecoder().decode(result.stderr);
      throw new DockerError([this.dockerBinary, ...args], result.exitCode, stderrStr);
    }

    const containerId = new TextDecoder().decode(result.stdout).trim();
    return containerId;
  }

  async startContainer(containerId: string): Promise<void> {
    const args = ["start", containerId];
    const result = await this.runSubprocess(args);
    if (result.exitCode !== 0) {
      const stderrStr = new TextDecoder().decode(result.stderr);
      throw new DockerError([this.dockerBinary, ...args], result.exitCode, stderrStr);
    }
  }

  async exec(
    containerId: string,
    command: ReadonlyArray<string>,
    options?: DockerExecOptions,
  ): Promise<DockerExecProcessResult> {
    const args = buildExecArgs(containerId, command, options);
    return this.runSubprocess(args, {
      timeoutMs: options?.timeoutMs,
      onStdoutChunk: options?.onStdoutChunk,
      onStderrChunk: options?.onStderrChunk,
    });
  }

  async inspectContainer(containerId: string): Promise<ContainerInspectInfo> {
    const args = ["inspect", containerId];
    const result = await this.runSubprocess(args);
    if (result.exitCode !== 0) {
      const stderrStr = new TextDecoder().decode(result.stderr);
      throw new DockerError([this.dockerBinary, ...args], result.exitCode, stderrStr);
    }

    const rawJson = new TextDecoder().decode(result.stdout);
    const parsed = JSON.parse(rawJson) as ReadonlyArray<RawDockerInspectItem>;
    const item = parsed[0];
    if (!item) {
      throw new DockerError(
        [this.dockerBinary, ...args],
        result.exitCode,
        "Inspect returned empty array",
      );
    }

    const state: ContainerInspectState = {
      status: item.State?.Status ?? "unknown",
      running: item.State?.Running ?? false,
      exitCode: item.State?.ExitCode ?? 0,
      oomKilled: item.State?.OOMKilled ?? false,
      startedAt: item.State?.StartedAt ?? "",
      finishedAt: item.State?.FinishedAt ?? "",
    };

    return {
      id: item.Id ?? containerId,
      name: item.Name ?? "",
      state,
      created: item.Created ?? "",
      config: {
        labels: item.Config?.Labels ?? {},
        image: item.Config?.Image ?? "",
        env: item.Config?.Env ?? [],
      },
    };
  }

  async killContainer(containerId: string, signal?: string): Promise<void> {
    const args: string[] = ["kill"];
    if (signal) {
      args.push("-s", signal);
    }
    args.push(containerId);

    const result = await this.runSubprocess(args);
    if (result.exitCode !== 0) {
      const stderrStr = new TextDecoder().decode(result.stderr);
      if (
        !stderrStr.toLowerCase().includes("is not running") &&
        !stderrStr.toLowerCase().includes("no such container")
      ) {
        throw new DockerError([this.dockerBinary, ...args], result.exitCode, stderrStr);
      }
    }
  }

  async removeContainer(
    containerId: string,
    options?: { readonly force?: boolean; readonly removeVolumes?: boolean },
  ): Promise<void> {
    const args: string[] = ["rm"];
    if (options?.force === true) {
      args.push("-f");
    }
    if (options?.removeVolumes === true) {
      args.push("-v");
    }
    args.push(containerId);

    const result = await this.runSubprocess(args);
    if (result.exitCode !== 0) {
      const stderrStr = new TextDecoder().decode(result.stderr);
      if (!stderrStr.toLowerCase().includes("no such container")) {
        throw new DockerError([this.dockerBinary, ...args], result.exitCode, stderrStr);
      }
    }
  }

  async createVolume(
    name: string,
    options?: { readonly labels?: Record<string, string> },
  ): Promise<void> {
    const args: string[] = ["volume", "create", name];
    if (options?.labels) {
      for (const [k, v] of Object.entries(options.labels)) {
        args.push("--label", `${k}=${v}`);
      }
    }

    const result = await this.runSubprocess(args);
    if (result.exitCode !== 0) {
      const stderrStr = new TextDecoder().decode(result.stderr);
      throw new DockerError([this.dockerBinary, ...args], result.exitCode, stderrStr);
    }
  }

  async removeVolume(name: string, options?: { readonly force?: boolean }): Promise<void> {
    const args: string[] = ["volume", "rm"];
    if (options?.force === true) {
      args.push("-f");
    }
    args.push(name);

    const result = await this.runSubprocess(args);
    if (result.exitCode !== 0) {
      const stderrStr = new TextDecoder().decode(result.stderr);
      if (!stderrStr.toLowerCase().includes("no such volume")) {
        throw new DockerError([this.dockerBinary, ...args], result.exitCode, stderrStr);
      }
    }
  }

  async listContainers(options?: {
    readonly all?: boolean;
    readonly filters?: Record<string, string | ReadonlyArray<string>>;
  }): Promise<ReadonlyArray<ContainerInspectInfo>> {
    const args = buildListContainersArgs(options);
    const result = await this.runSubprocess(args);
    if (result.exitCode !== 0) {
      const stderrStr = new TextDecoder().decode(result.stderr);
      throw new DockerError([this.dockerBinary, ...args], result.exitCode, stderrStr);
    }

    const outputText = new TextDecoder().decode(result.stdout).trim();
    if (!outputText) {
      return [];
    }

    const ids = outputText.split(/\s+/).filter(Boolean);
    const infos: ContainerInspectInfo[] = [];
    for (const id of ids) {
      try {
        const info = await this.inspectContainer(id);
        infos.push(info);
      } catch {}
    }

    return infos;
  }

  async listVolumes(options?: {
    readonly filters?: Record<string, string | ReadonlyArray<string>>;
  }): Promise<ReadonlyArray<VolumeInspectInfo>> {
    const args = buildListVolumesArgs(options);
    const result = await this.runSubprocess(args);
    if (result.exitCode !== 0) {
      const stderrStr = new TextDecoder().decode(result.stderr);
      throw new DockerError([this.dockerBinary, ...args], result.exitCode, stderrStr);
    }

    const outputText = new TextDecoder().decode(result.stdout).trim();
    if (!outputText) {
      return [];
    }

    const names = outputText.split(/\s+/).filter(Boolean);
    const inspectArgs = ["volume", "inspect", ...names];
    const inspectResult = await this.runSubprocess(inspectArgs);
    if (inspectResult.exitCode !== 0) {
      return names.map((name) => ({
        name,
        driver: "local",
        labels: {},
      }));
    }

    const inspectRaw = new TextDecoder().decode(inspectResult.stdout);
    const parsed = JSON.parse(inspectRaw) as ReadonlyArray<RawDockerVolumeInspectItem>;

    return parsed.map((item) => ({
      name: item.Name ?? "",
      driver: item.Driver ?? "local",
      labels: item.Labels ?? {},
      createdAt: item.CreatedAt,
    }));
  }
}

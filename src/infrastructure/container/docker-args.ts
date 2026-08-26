import type { DockerCreateOptions, DockerExecOptions } from "./types.js";

export interface RawDockerInspectState {
  Status?: string;
  Running?: boolean;
  ExitCode?: number;
  OOMKilled?: boolean;
  StartedAt?: string;
  FinishedAt?: string;
}

export interface RawDockerInspectConfig {
  Labels?: Record<string, string> | null;
  Image?: string;
  Env?: string[] | null;
}

export interface RawDockerInspectItem {
  Id?: string;
  Name?: string;
  Created?: string;
  State?: RawDockerInspectState;
  Config?: RawDockerInspectConfig;
}

export interface RawDockerVolumeInspectItem {
  Name?: string;
  Driver?: string;
  Labels?: Record<string, string> | null;
  CreatedAt?: string;
}

export function buildCreateContainerArgs(options: DockerCreateOptions): string[] {
  const args: string[] = ["create", "--name", options.name];

  if (options.user) {
    args.push("--user", options.user);
  }
  if (options.workingDir) {
    args.push("-w", options.workingDir);
  }
  if (options.network) {
    args.push("--network", options.network);
  }

  if (options.bindMounts) {
    for (const mount of options.bindMounts) {
      const ro = mount.readonly === true ? ":ro" : "";
      args.push("-v", `${mount.hostPath}:${mount.containerPath}${ro}`);
    }
  }

  if (options.volumeMounts) {
    for (const mount of options.volumeMounts) {
      const ro = mount.readonly === true ? ":ro" : "";
      args.push("-v", `${mount.volumeName}:${mount.containerPath}${ro}`);
    }
  }

  if (options.resourceLimits) {
    const limits = options.resourceLimits;
    if (limits.cpus > 0) {
      args.push("--cpus", limits.cpus.toString());
    }
    if (limits.memoryMb > 0) {
      args.push("--memory", `${limits.memoryMb}m`);
    }
    if (limits.pidsLimit > 0) {
      args.push("--pids-limit", limits.pidsLimit.toString());
    }
    if (limits.cpuShares !== undefined && limits.cpuShares > 0) {
      args.push("--cpu-shares", limits.cpuShares.toString());
    }
    if (limits.memorySwapMb !== undefined && limits.memorySwapMb > 0) {
      args.push("--memory-swap", `${limits.memorySwapMb}m`);
    }
    if (limits.memoryReservationMb !== undefined && limits.memoryReservationMb > 0) {
      args.push("--memory-reservation", `${limits.memoryReservationMb}m`);
    }
    if (limits.storageOptSize) {
      args.push("--storage-opt", `size=${limits.storageOptSize}`);
    }
  }

  if (options.securityOpts) {
    for (const opt of options.securityOpts) {
      args.push("--security-opt", opt);
    }
  }

  if (options.capDrop) {
    for (const cap of options.capDrop) {
      args.push("--cap-drop", cap);
    }
  }

  if (options.capAdd) {
    for (const cap of options.capAdd) {
      args.push("--cap-add", cap);
    }
  }

  if (options.labels) {
    for (const [key, value] of Object.entries(options.labels)) {
      args.push("-l", `${key}=${value}`);
    }
  }

  if (options.environment) {
    for (const [key, value] of Object.entries(options.environment)) {
      args.push("-e", `${key}=${value}`);
    }
  }

  if (options.autoRemove === true) {
    args.push("--rm");
  }

  if (options.entrypoint && options.entrypoint.length > 0) {
    args.push("--entrypoint", options.entrypoint[0] ?? "");
  }

  args.push(options.image);

  if (options.command) {
    args.push(...options.command);
  }

  return args;
}

export function buildExecArgs(
  containerId: string,
  command: ReadonlyArray<string>,
  options?: DockerExecOptions,
): string[] {
  const args: string[] = ["exec"];

  if (options?.user) {
    args.push("-u", options.user);
  }
  if (options?.cwd) {
    args.push("-w", options.cwd);
  }
  if (options?.env) {
    for (const [k, v] of Object.entries(options.env)) {
      args.push("-e", `${k}=${v}`);
    }
  }

  args.push(containerId, ...command);
  return args;
}

export function buildListContainersArgs(options?: {
  readonly all?: boolean;
  readonly filters?: Record<string, string | ReadonlyArray<string>>;
}): string[] {
  const args: string[] = ["ps", "-q"];
  if (options?.all !== false) {
    args.push("-a");
  }
  if (options?.filters) {
    for (const [k, v] of Object.entries(options.filters)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          args.push("--filter", `${k}=${item}`);
        }
      } else {
        args.push("--filter", `${k}=${v}`);
      }
    }
  }
  return args;
}

export function buildListVolumesArgs(options?: {
  readonly filters?: Record<string, string | ReadonlyArray<string>>;
}): string[] {
  const args: string[] = ["volume", "ls", "-q"];
  if (options?.filters) {
    for (const [k, v] of Object.entries(options.filters)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          args.push("--filter", `${k}=${item}`);
        }
      } else {
        args.push("--filter", `${k}=${v}`);
      }
    }
  }
  return args;
}

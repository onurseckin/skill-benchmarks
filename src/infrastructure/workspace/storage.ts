import { chmod, mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { IDockerClient } from "../container/types.js";
import type { WorkspaceArtifactPaths, WorkspaceConfig, WorkspaceLayout } from "./types.js";

export const STORAGE_LABELS = {
  MANAGED: "io.skill-benchmarks.managed",
  VOLUME_ROLE: "io.skill-benchmarks.volume",
  RUN_ID: "io.skill-benchmarks.run-id",
  SCENARIO_ID: "io.skill-benchmarks.scenario-id",
} as const;

export const DEFAULT_ARTIFACTS_BASE_DIR = ".benchmarks/runs";

export function resolveArtifactPaths(runDir: string): WorkspaceArtifactPaths {
  const absoluteRunDir = resolve(runDir);
  return {
    runDir: absoluteRunDir,
    preRunManifestPath: join(absoluteRunDir, "pre-run-manifest.json"),
    gitDiffPath: join(absoluteRunDir, "git.diff"),
    diffManifestPath: join(absoluteRunDir, "diff-manifest.json"),
    eventsPath: join(absoluteRunDir, "events.jsonl"),
    rawLogPath: join(absoluteRunDir, "raw.log"),
    metricsPath: join(absoluteRunDir, "metrics.json"),
    evaluationPath: join(absoluteRunDir, "evaluation.json"),
  };
}

export function formatVolumeName(runId: string): string {
  const sanitizedRunId = runId.replace(/[^a-zA-Z0-9_.-]/g, "-");
  return `sb-vol-${sanitizedRunId}`;
}

export class WorkspaceStorageManager {
  private readonly dockerClient?: IDockerClient;
  private readonly baseArtifactsDir: string;

  constructor(options?: {
    readonly dockerClient?: IDockerClient;
    readonly baseArtifactsDir?: string;
  }) {
    this.dockerClient = options?.dockerClient;
    this.baseArtifactsDir = options?.baseArtifactsDir ?? DEFAULT_ARTIFACTS_BASE_DIR;
  }

  public resolveLayout(config: WorkspaceConfig): WorkspaceLayout {
    const volumeName = config.volumeName ?? formatVolumeName(config.runId);
    const hostArtifactDir =
      config.hostArtifactsPath ?? resolve(this.baseArtifactsDir, config.runId);
    const containerWorkspaceDir = config.containerWorkspacePath ?? "/workspace";
    const containerArtifactDir = config.containerArtifactsPath ?? "/artifacts";

    return {
      runId: config.runId,
      scenarioId: config.scenarioId,
      volumeName,
      hostArtifactDir,
      containerWorkspaceDir,
      containerArtifactDir,
      artifacts: resolveArtifactPaths(hostArtifactDir),
    };
  }

  public async prepareHostArtifactDirectory(hostArtifactDir: string): Promise<string> {
    const absolutePath = resolve(hostArtifactDir);
    await mkdir(absolutePath, { recursive: true });

    try {
      await chmod(absolutePath, 0o777);
    } catch {}

    return absolutePath;
  }

  public async provisionWorkspaceVolume(
    volumeName: string,
    metadata?: { readonly runId?: string; readonly scenarioId?: string },
  ): Promise<string> {
    if (!this.dockerClient) {
      throw new Error(
        "Cannot provision Docker volume: no IDockerClient was provided to WorkspaceStorageManager.",
      );
    }

    const labels: Record<string, string> = {
      [STORAGE_LABELS.MANAGED]: "true",
      [STORAGE_LABELS.VOLUME_ROLE]: "workspace",
    };

    if (metadata?.runId) {
      labels[STORAGE_LABELS.RUN_ID] = metadata.runId;
    }
    if (metadata?.scenarioId) {
      labels[STORAGE_LABELS.SCENARIO_ID] = metadata.scenarioId;
    }

    await this.dockerClient.createVolume(volumeName, { labels });
    return volumeName;
  }

  public async setupWorkspace(config: WorkspaceConfig): Promise<WorkspaceLayout> {
    const layout = this.resolveLayout(config);

    await this.prepareHostArtifactDirectory(layout.hostArtifactDir);

    if (this.dockerClient) {
      await this.provisionWorkspaceVolume(layout.volumeName, {
        runId: config.runId,
        scenarioId: config.scenarioId,
      });
    }

    return layout;
  }

  public async teardownWorkspaceVolume(volumeName: string): Promise<void> {
    if (!this.dockerClient) {
      return;
    }

    try {
      await this.dockerClient.removeVolume(volumeName, { force: true });
    } catch (err) {
      console.warn(`Failed to remove volume ${volumeName}:`, err);
    }
  }

  public async purgeHostArtifactDirectory(hostArtifactDir: string): Promise<void> {
    const absolutePath = resolve(hostArtifactDir);
    try {
      const dirStat = await stat(absolutePath);
      if (dirStat.isDirectory()) {
        await rm(absolutePath, { recursive: true, force: true });
      }
    } catch {}
  }
}

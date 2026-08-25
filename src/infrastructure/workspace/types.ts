export type FileChangeType =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "permission_change";

export interface FileModification {
  readonly path: string;
  readonly changeType: FileChangeType;
  readonly oldPath?: string;
  readonly oldMode?: string;
  readonly newMode?: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly isBinary: boolean;
  readonly sha256Before?: string;
  readonly sha256After?: string;
}

export interface DiffSummary {
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly netLines: number;
  readonly totalHunks: number;
  readonly binaryFilesCount: number;
}

export interface DiffManifest {
  readonly runId: string;
  readonly scenarioId: string;
  readonly baseCommitSha: string;
  readonly generatedAt: string;
  readonly summary: DiffSummary;
  readonly fileModifications: ReadonlyArray<FileModification>;
}

export interface PreRunFingerprintManifest {
  readonly runId: string;
  readonly scenarioId: string;
  readonly timestamp: string;
  readonly fileCount: number;
  readonly files: Record<string, string>;
}

export interface WorkspaceConfig {
  readonly runId: string;
  readonly scenarioId: string;
  readonly volumeName?: string;
  readonly containerWorkspacePath?: string;
  readonly hostArtifactsPath?: string;
  readonly containerArtifactsPath?: string;
}

export interface WorkspaceArtifactPaths {
  readonly runDir: string;
  readonly preRunManifestPath: string;
  readonly gitDiffPath: string;
  readonly diffManifestPath: string;
  readonly eventsPath: string;
  readonly rawLogPath: string;
  readonly metricsPath: string;
  readonly evaluationPath: string;
}

export interface RunArtifactLayout {
  readonly outputRoot: string;
  readonly runDirectory: string;
  readonly manifestPath: string;
  readonly eventsPath: string;
  readonly transcriptPath: string;
  readonly rawLogPath: string;
  readonly metricsPath: string;
  readonly evaluationPath: string;
  readonly gitDiffPath: string;
  readonly diffManifestPath: string;
  readonly resultPath: string;
}

export interface DisposableWorkspace {
  readonly rootPath: string;
  dispose(): Promise<void>;
}

export interface WorkspaceLayout {
  readonly runId: string;
  readonly scenarioId: string;
  readonly volumeName: string;
  readonly hostArtifactDir: string;
  readonly containerWorkspaceDir: string;
  readonly containerArtifactDir: string;
  readonly artifacts: WorkspaceArtifactPaths;
}

export interface FingerprintOptions {
  readonly runId?: string;
  readonly scenarioId?: string;
  readonly ignorePatterns?: ReadonlyArray<string | RegExp>;
  readonly includeHidden?: boolean;
}

export interface HydrationOptions {
  readonly runId: string;
  readonly scenarioId: string;
  readonly fixtureSourcePath: string;
  readonly targetContainerId?: string;
  readonly targetWorkspacePath?: string;
  readonly user?: string;
  readonly group?: string;
  readonly commitMessage?: string;
  readonly baselineTag?: string;
  readonly branchName?: string;
  readonly computeFingerprint?: boolean;
}

export interface HydrationResult {
  readonly success: boolean;
  readonly baselineSha: string;
  readonly fingerprint?: PreRunFingerprintManifest;
  readonly durationMs: number;
  readonly filesHydrated: number;
}

export interface ExtractDiffOptions {
  readonly runId: string;
  readonly scenarioId: string;
  readonly baselineTag?: string;
  readonly artifactHostPath?: string;
  readonly saveArtifacts?: boolean;
  readonly beforeFingerprint?: PreRunFingerprintManifest;
}

export interface DiffExtractionResult {
  readonly rawDiff: string;
  readonly manifest: DiffManifest;
  readonly durationMs: number;
}

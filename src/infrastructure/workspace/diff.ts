import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IDockerClient } from "../container/types.js";
import { generateWorkspaceFingerprint } from "./fingerprint.js";
import type {
  DiffExtractionResult,
  DiffManifest,
  DiffSummary,
  ExtractDiffOptions,
  FileChangeType,
  FileModification,
  PreRunFingerprintManifest,
} from "./types.js";

function normalizeDiffPath(rawPath: string): string {
  let cleaned = rawPath.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }
  if (cleaned.startsWith("a/") || cleaned.startsWith("b/")) {
    cleaned = cleaned.slice(2);
  }
  return cleaned;
}

export function parseGitDiff(
  rawDiff: string,
  metadata: {
    readonly runId: string;
    readonly scenarioId: string;
    readonly baseCommitSha?: string;
    readonly generatedAt?: string;
    readonly beforeFingerprint?: PreRunFingerprintManifest;
    readonly afterFingerprint?: PreRunFingerprintManifest;
  },
): DiffManifest {
  const lines = rawDiff.split(/\r?\n/);
  const fileModifications: FileModification[] = [];

  let currentFile: {
    path: string;
    oldPath?: string;
    changeType: FileChangeType;
    oldMode?: string;
    newMode?: string;
    insertions: number;
    deletions: number;
    isBinary: boolean;
    hunkCount: number;
  } | null = null;

  let totalHunksCount = 0;

  function commitCurrentFile(): void {
    if (!currentFile) return;

    let sha256Before: string | undefined;
    let sha256After: string | undefined;

    if (metadata.beforeFingerprint) {
      const lookupPath = currentFile.oldPath ?? currentFile.path;
      sha256Before = metadata.beforeFingerprint.files[lookupPath];
    }
    if (metadata.afterFingerprint) {
      sha256After = metadata.afterFingerprint.files[currentFile.path];
    }

    fileModifications.push({
      path: currentFile.path,
      changeType: currentFile.changeType,
      oldPath: currentFile.oldPath,
      oldMode: currentFile.oldMode,
      newMode: currentFile.newMode,
      insertions: currentFile.insertions,
      deletions: currentFile.deletions,
      isBinary: currentFile.isBinary,
      sha256Before,
      sha256After,
    });

    currentFile = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.startsWith("diff --git ")) {
      commitCurrentFile();

      const headerPart = line.slice("diff --git ".length);
      const match = headerPart.match(/^(?:a\/(.+?)|"a\/(.+?)")\s+(?:b\/(.+?)|"b\/(.+?)")$/);

      let rawA = "";
      let rawB = "";

      if (match) {
        rawA = match[1] ?? match[2] ?? "";
        rawB = match[3] ?? match[4] ?? "";
      } else {
        const parts = headerPart.split(" ");
        rawA = normalizeDiffPath(parts[0] ?? "");
        rawB = normalizeDiffPath(parts[1] ?? "");
      }

      currentFile = {
        path: rawB || rawA,
        oldPath: rawA !== rawB ? rawA : undefined,
        changeType: "modified",
        insertions: 0,
        deletions: 0,
        isBinary: false,
        hunkCount: 0,
      };
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith("new file mode ")) {
      currentFile.changeType = "added";
      currentFile.newMode = line.slice("new file mode ".length).trim();
    } else if (line.startsWith("deleted file mode ")) {
      currentFile.changeType = "deleted";
      currentFile.oldMode = line.slice("deleted file mode ".length).trim();
    } else if (line.startsWith("old mode ")) {
      currentFile.oldMode = line.slice("old mode ".length).trim();
      if (currentFile.changeType === "modified") {
        currentFile.changeType = "permission_change";
      }
    } else if (line.startsWith("new mode ")) {
      currentFile.newMode = line.slice("new mode ".length).trim();
      if (currentFile.changeType === "modified") {
        currentFile.changeType = "permission_change";
      }
    } else if (line.startsWith("rename from ")) {
      currentFile.changeType = "renamed";
      currentFile.oldPath = line.slice("rename from ".length).trim();
    } else if (line.startsWith("rename to ")) {
      currentFile.changeType = "renamed";
      currentFile.path = line.slice("rename to ".length).trim();
    } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      currentFile.isBinary = true;
    } else if (line.startsWith("@@ ")) {
      currentFile.hunkCount++;
      totalHunksCount++;
      if (currentFile.changeType === "permission_change") {
        currentFile.changeType = "modified";
      }
    } else if (currentFile.hunkCount > 0 && !currentFile.isBinary) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentFile.insertions++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        currentFile.deletions++;
      }
    }
  }

  commitCurrentFile();

  let totalInsertions = 0;
  let totalDeletions = 0;
  let binaryFilesCount = 0;

  for (const mod of fileModifications) {
    totalInsertions += mod.insertions;
    totalDeletions += mod.deletions;
    if (mod.isBinary) {
      binaryFilesCount++;
    }
  }

  const summary: DiffSummary = {
    filesChanged: fileModifications.length,
    insertions: totalInsertions,
    deletions: totalDeletions,
    netLines: totalInsertions - totalDeletions,
    totalHunks: totalHunksCount,
    binaryFilesCount,
  };

  return {
    runId: metadata.runId,
    scenarioId: metadata.scenarioId,
    baseCommitSha: metadata.baseCommitSha ?? "unknown",
    generatedAt: metadata.generatedAt ?? new Date().toISOString(),
    summary,
    fileModifications,
  };
}

function runGitCommand(
  args: ReadonlyArray<string>,
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn("git", [...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    proc.on("error", (err) => {
      rejectPromise(err);
    });

    proc.on("close", (code) => {
      resolvePromise({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? 0,
      });
    });
  });
}

export async function extractDiffFromLocal(
  workspaceDir: string,
  options: ExtractDiffOptions,
): Promise<DiffExtractionResult> {
  const startTime = Date.now();
  const absoluteDir = resolve(workspaceDir);
  const baselineTag = options.baselineTag ?? "baseline";

  await runGitCommand(["add", "--intent-to-add", "."], absoluteDir);

  const diffResult = await runGitCommand(
    ["diff", "--binary", "--full-index", baselineTag],
    absoluteDir,
  );

  const rawDiff = diffResult.stdout;

  const shaResult = await runGitCommand(["rev-parse", baselineTag], absoluteDir);
  const baseCommitSha = shaResult.exitCode === 0 ? shaResult.stdout.trim() : "unknown";

  const afterFingerprint = await generateWorkspaceFingerprint(absoluteDir, {
    runId: options.runId,
    scenarioId: options.scenarioId,
  });

  const manifest = parseGitDiff(rawDiff, {
    runId: options.runId,
    scenarioId: options.scenarioId,
    baseCommitSha,
    beforeFingerprint: options.beforeFingerprint,
    afterFingerprint,
  });

  if (options.saveArtifacts && options.artifactHostPath) {
    const artifactDir = resolve(options.artifactHostPath);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "git.diff"), rawDiff, "utf-8");
    await writeFile(
      resolve(artifactDir, "diff-manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );
  }

  const durationMs = Date.now() - startTime;

  return {
    rawDiff,
    manifest,
    durationMs,
  };
}

export async function extractDiffFromContainer(
  dockerClient: IDockerClient,
  containerId: string,
  options: ExtractDiffOptions,
  containerWorkspacePath = "/workspace",
): Promise<DiffExtractionResult> {
  const startTime = Date.now();
  const baselineTag = options.baselineTag ?? "baseline";

  const diffScript = `
cd ${containerWorkspacePath} && \
git add --intent-to-add . && \
git diff --binary --full-index ${baselineTag}
`;

  const diffExec = await dockerClient.exec(containerId, ["bash", "-c", diffScript], {
    cwd: containerWorkspacePath,
  });

  if (diffExec.exitCode !== 0) {
    const errorText = new TextDecoder().decode(diffExec.stderr);
    throw new Error(`Failed to extract git diff from container ${containerId}: ${errorText}`);
  }

  const rawDiff = new TextDecoder().decode(diffExec.stdout);

  const shaScript = `cd ${containerWorkspacePath} && git rev-parse ${baselineTag}`;
  const shaExec = await dockerClient.exec(containerId, ["bash", "-c", shaScript], {
    cwd: containerWorkspacePath,
  });

  const baseCommitSha =
    shaExec.exitCode === 0 ? new TextDecoder().decode(shaExec.stdout).trim() : "unknown";

  const manifest = parseGitDiff(rawDiff, {
    runId: options.runId,
    scenarioId: options.scenarioId,
    baseCommitSha,
    beforeFingerprint: options.beforeFingerprint,
  });

  if (options.saveArtifacts && options.artifactHostPath) {
    const artifactDir = resolve(options.artifactHostPath);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "git.diff"), rawDiff, "utf-8");
    await writeFile(
      resolve(artifactDir, "diff-manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );
  }

  const durationMs = Date.now() - startTime;

  return {
    rawDiff,
    manifest,
    durationMs,
  };
}

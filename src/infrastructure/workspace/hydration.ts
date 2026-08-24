import { spawn } from "node:child_process";
import { cp, mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { IDockerClient } from "../container/types.js";
import { generateWorkspaceFingerprint } from "./fingerprint.js";
import { packDirectoryToTar, unpackTarToDirectory } from "./tar.js";
import type { HydrationOptions, HydrationResult } from "./types.js";

export { packDirectoryToTar, unpackTarToDirectory };

function runLocalCommand(
  command: string,
  args: ReadonlyArray<string>,
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(command, [...args], {
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

export async function hydrateLocalWorkspace(
  targetDir: string,
  options: HydrationOptions
): Promise<HydrationResult> {
  const startTime = Date.now();
  const absoluteTarget = resolve(targetDir);
  const absoluteFixture = resolve(options.fixtureSourcePath);

  await mkdir(absoluteTarget, { recursive: true });

  await cp(absoluteFixture, absoluteTarget, {
    recursive: true,
    force: true,
  });

  const commitMessage = options.commitMessage ?? "Initial scenario baseline";
  const baselineTag = options.baselineTag ?? "baseline";
  const branchName = options.branchName ?? "benchmark-run";

  let isGitRepo = false;
  try {
    const gitDirStat = await stat(resolve(absoluteTarget, ".git"));
    isGitRepo = gitDirStat.isDirectory();
  } catch {
    isGitRepo = false;
  }

  if (!isGitRepo) {
    const initRes = await runLocalCommand("git", ["init"], absoluteTarget);
    if (initRes.exitCode !== 0) {
      throw new Error(`git init failed: ${initRes.stderr}`);
    }

    await runLocalCommand(
      "git",
      ["config", "user.name", "Skill Benchmark"],
      absoluteTarget
    );
    await runLocalCommand(
      "git",
      ["config", "user.email", "benchmark@skill-benchmarks.io"],
      absoluteTarget
    );

    const addRes = await runLocalCommand("git", ["add", "-A"], absoluteTarget);
    if (addRes.exitCode !== 0) {
      throw new Error(`git add failed: ${addRes.stderr}`);
    }

    const commitRes = await runLocalCommand(
      "git",
      ["commit", "-m", commitMessage, "--allow-empty"],
      absoluteTarget
    );
    if (commitRes.exitCode !== 0) {
      throw new Error(`git commit failed: ${commitRes.stderr}`);
    }

    const tagRes = await runLocalCommand(
      "git",
      ["tag", baselineTag],
      absoluteTarget
    );
    if (tagRes.exitCode !== 0) {
      throw new Error(`git tag failed: ${tagRes.stderr}`);
    }
  } else {
    await runLocalCommand(
      "git",
      ["checkout", "-B", branchName],
      absoluteTarget
    );
    const tagRes = await runLocalCommand(
      "git",
      ["tag", "-f", baselineTag],
      absoluteTarget
    );
    if (tagRes.exitCode !== 0) {
      throw new Error(`git tag -f failed: ${tagRes.stderr}`);
    }
  }

  const shaRes = await runLocalCommand(
    "git",
    ["rev-parse", baselineTag],
    absoluteTarget
  );
  const baselineSha = shaRes.stdout.trim();

  let fingerprint;
  if (options.computeFingerprint !== false) {
    fingerprint = await generateWorkspaceFingerprint(absoluteTarget, {
      runId: options.runId,
      scenarioId: options.scenarioId,
    });
  }

  const durationMs = Date.now() - startTime;
  const filesHydrated = fingerprint ? fingerprint.fileCount : 0;

  return {
    success: true,
    baselineSha,
    fingerprint,
    durationMs,
    filesHydrated,
  };
}

export async function hydrateContainerWorkspace(
  dockerClient: IDockerClient,
  containerId: string,
  options: HydrationOptions
): Promise<HydrationResult> {
  const startTime = Date.now();
  const targetWorkspace = options.targetWorkspacePath ?? "/workspace";
  const user = options.user ?? "sandbox";
  const group = options.group ?? "sandbox";
  const commitMessage = options.commitMessage ?? "Initial scenario baseline";
  const baselineTag = options.baselineTag ?? "baseline";
  const branchName = options.branchName ?? "benchmark-run";

  const tarBytes = await packDirectoryToTar(options.fixtureSourcePath);

  await dockerClient.exec(
    containerId,
    ["mkdir", "-p", targetWorkspace],
    { user: "root" }
  );

  const unpackScript = `tar -xf - -C ${targetWorkspace}`;
  const unpackExec = await dockerClient.exec(
    containerId,
    ["bash", "-c", unpackScript],
    {
      user: "root",
    }
  );

  if (unpackExec.exitCode !== 0) {
    const errorText = new TextDecoder().decode(unpackExec.stderr);
    throw new Error(
      `Failed to extract fixture tar into container ${containerId}: ${errorText}`
    );
  }

  const chownExec = await dockerClient.exec(
    containerId,
    ["chown", "-R", `${user}:${group}`, targetWorkspace],
    { user: "root" }
  );

  if (chownExec.exitCode !== 0) {
    const errorText = new TextDecoder().decode(chownExec.stderr);
    throw new Error(
      `Failed to chown workspace in container ${containerId}: ${errorText}`
    );
  }

  const gitSetupScript = `
cd ${targetWorkspace} && \
if [ ! -d .git ]; then
  git init && \
  git config user.name "Skill Benchmark" && \
  git config user.email "benchmark@skill-benchmarks.io" && \
  git add -A && \
  git commit -m '${commitMessage.replace(/'/g, "'\\''")}' --allow-empty && \
  git tag ${baselineTag}
else
  git checkout -B ${branchName} && \
  git tag -f ${baselineTag}
fi && \
git rev-parse ${baselineTag}
`;

  const gitExec = await dockerClient.exec(
    containerId,
    ["bash", "-c", gitSetupScript],
    {
      user,
      cwd: targetWorkspace,
    }
  );

  if (gitExec.exitCode !== 0) {
    const errorText = new TextDecoder().decode(gitExec.stderr);
    throw new Error(
      `Failed to initialize baseline git repo in container ${containerId}: ${errorText}`
    );
  }

  const baselineSha = new TextDecoder().decode(gitExec.stdout).trim();

  let fingerprint;
  if (options.computeFingerprint !== false) {
    fingerprint = await generateWorkspaceFingerprint(
      options.fixtureSourcePath,
      {
        runId: options.runId,
        scenarioId: options.scenarioId,
      }
    );
  }

  const durationMs = Date.now() - startTime;
  const filesHydrated = fingerprint ? fingerprint.fileCount : 0;

  return {
    success: true,
    baselineSha,
    fingerprint,
    durationMs,
    filesHydrated,
  };
}

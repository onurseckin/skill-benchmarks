import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

export async function packDirectoryToTar(
  sourceDir: string
): Promise<Uint8Array> {
  const absoluteSource = resolve(sourceDir);
  let dirStat;
  try {
    dirStat = await stat(absoluteSource);
  } catch {
    throw new Error(
      `Fixture source path is not a directory or does not exist: ${absoluteSource}`
    );
  }
  if (!dirStat.isDirectory()) {
    throw new Error(
      `Fixture source path is not a directory: ${absoluteSource}`
    );
  }

  return new Promise<Uint8Array>((resolvePromise, rejectPromise) => {
    const tarProcess = spawn("tar", ["-cf", "-", "-C", absoluteSource, "."], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    tarProcess.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    tarProcess.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    tarProcess.on("error", (err) => {
      rejectPromise(
        new Error(`Failed to spawn tar process: ${err.message}`)
      );
    });

    tarProcess.on("close", (code) => {
      if (code !== 0) {
        const stderrText = Buffer.concat(stderrChunks).toString("utf-8");
        rejectPromise(
          new Error(`tar archive creation failed with code ${code}: ${stderrText}`)
        );
      } else {
        const totalBuffer = Buffer.concat(chunks);
        resolvePromise(new Uint8Array(totalBuffer));
      }
    });
  });
}

export async function unpackTarToDirectory(
  tarBytes: Uint8Array,
  targetDir: string
): Promise<void> {
  const absoluteTarget = resolve(targetDir);
  await mkdir(absoluteTarget, { recursive: true });

  return new Promise<void>((resolvePromise, rejectPromise) => {
    const tarProcess = spawn("tar", ["-xf", "-", "-C", absoluteTarget], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stderrChunks: Buffer[] = [];

    tarProcess.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    tarProcess.on("error", (err) => {
      rejectPromise(
        new Error(`Failed to spawn tar unpack process: ${err.message}`)
      );
    });

    tarProcess.on("close", (code) => {
      if (code !== 0) {
        const stderrText = Buffer.concat(stderrChunks).toString("utf-8");
        rejectPromise(
          new Error(`tar extraction failed with code ${code}: ${stderrText}`)
        );
      } else {
        resolvePromise();
      }
    });

    tarProcess.stdin.write(Buffer.from(tarBytes));
    tarProcess.stdin.end();
  });
}

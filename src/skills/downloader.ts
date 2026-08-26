import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SkillDownloadOptions, SkillManifest, SkillSourceType } from "./types";
import { parseSkillContent } from "./parser";
import { validateSkillManifest, SkillValidationError } from "./validator";
import {
  computeSha256,
  findManifestFile,
  isCacheFresh,
  sanitizeSkillId,
} from "./download-cache.js";

export { computeSha256, isCacheFresh, sanitizeSkillId } from "./download-cache.js";

export interface SkillDownloadResult {
  readonly manifest: SkillManifest;
  readonly targetDir: string;
  readonly cached: boolean;
  readonly hash: string;
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: SkillDownloadOptions,
): Promise<Response> {
  const maxRetries =
    options !== undefined && options.maxRetries !== undefined ? options.maxRetries : 3;
  const initialDelayMs =
    options !== undefined && options.initialDelayMs !== undefined ? options.initialDelayMs : 500;
  const backoffFactor =
    options !== undefined && options.backoffFactor !== undefined ? options.backoffFactor : 2;
  const timeoutMs =
    options !== undefined && options.timeoutMs !== undefined ? options.timeoutMs : 30000;

  const requestHeaders: Record<string, string> = {};
  if (init !== undefined && init.headers !== undefined) {
    const customHeaders = init.headers as Record<string, string>;
    for (const key of Object.keys(customHeaders)) {
      const val = customHeaders[key];
      if (val !== undefined) requestHeaders[key] = val;
    }
  }

  if (options !== undefined && options.token !== undefined && options.token.length > 0) {
    requestHeaders["Authorization"] = options.token.startsWith("Bearer ")
      ? options.token
      : `Bearer ${options.token}`;
  }

  let lastError: Error | null = null;
  let currentDelay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        ...init,
        headers: requestHeaders,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) return response;

      const shouldRetryStatus = response.status === 429 ? true : response.status >= 500;
      if (shouldRetryStatus && attempt < maxRetries) {
        await Bun.sleep(currentDelay);
        currentDelay = currentDelay * backoffFactor;
        continue;
      }

      throw new Error(
        `HTTP fetch failed with status ${response.status} (${response.statusText}) for URL: ${url}`,
      );
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await Bun.sleep(currentDelay);
        currentDelay = currentDelay * backoffFactor;
      }
    }
  }

  const finalMessage = lastError !== null ? lastError.message : `Failed to fetch ${url}`;
  throw new Error(`fetchWithRetry exhausted ${maxRetries} retries: ${finalMessage}`);
}

export async function downloadFromGit(
  gitUrl: string,
  targetDir: string,
  options?: SkillDownloadOptions,
): Promise<string> {
  const args: string[] = ["clone"];
  const isShallow = options === undefined || options.shallow === undefined ? true : options.shallow;
  if (isShallow) args.push("--depth", "1");
  if (options !== undefined && options.branch !== undefined && options.branch.length > 0) {
    args.push("--branch", options.branch);
  }
  args.push(gitUrl, targetDir);

  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const errorText = await new Response(proc.stderr).text();
    throw new Error(`Git clone failed with code ${exitCode}: ${errorText.trim()}`);
  }
  return targetDir;
}

export async function downloadFromHttp(
  url: string,
  targetDir: string,
  options?: SkillDownloadOptions,
): Promise<string> {
  await mkdir(targetDir, { recursive: true });
  const isTarball = url.endsWith(".tar.gz")
    ? true
    : url.endsWith(".tgz")
      ? true
      : url.includes("/archive/");
  if (isTarball) {
    const response = await fetchWithRetry(url, undefined, options);
    const arrayBuffer = await response.arrayBuffer();
    const tempTarPath = join(targetDir, `temp-${randomUUID()}.tar.gz`);
    await writeFile(tempTarPath, Buffer.from(arrayBuffer));
    const proc = Bun.spawn(["tar", "-xzf", tempTarPath, "-C", targetDir, "--strip-components=1"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    await rm(tempTarPath, { force: true });
    if (exitCode !== 0) {
      const fallbackProc = Bun.spawn(["tar", "-xzf", tempTarPath, "-C", targetDir], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await fallbackProc.exited;
    }
    return targetDir;
  }

  let fetchUrl = url;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    fetchUrl = `https://raw.githubusercontent.com/${url}/main/SKILL.md`;
  }

  try {
    const response = await fetchWithRetry(fetchUrl, undefined, options);
    const textContent = await response.text();
    await writeFile(join(targetDir, "SKILL.md"), textContent, "utf-8");
    return targetDir;
  } catch (err) {
    if (fetchUrl.includes("/main/")) {
      const masterUrl = fetchUrl.replace("/main/", "/master/");
      const response = await fetchWithRetry(masterUrl, undefined, options);
      const textContent = await response.text();
      await writeFile(join(targetDir, "SKILL.md"), textContent, "utf-8");
      return targetDir;
    }
    throw err;
  }
}

export async function stageAndVerifySkill(
  stagingDir: string,
  targetDir: string,
  options?: SkillDownloadOptions,
): Promise<SkillManifest> {
  const manifestFile = await findManifestFile(stagingDir);
  if (manifestFile === null) {
    await rm(stagingDir, { recursive: true, force: true });
    throw new Error(`No valid skill manifest found in staged directory: ${stagingDir}`);
  }

  const rawContent = await readFile(manifestFile, "utf-8");
  const manifest = parseSkillContent(rawContent);
  const validation = validateSkillManifest(manifest);

  if (!validation.valid ? true : !validation.securityPass) {
    await rm(stagingDir, { recursive: true, force: true });
    throw new SkillValidationError(manifest.name, validation.errors);
  }

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(dirname(targetDir), { recursive: true });

  try {
    await rename(stagingDir, targetDir);
  } catch {
    const proc = Bun.spawn(["cp", "-R", `${stagingDir}/.`, targetDir]);
    await proc.exited;
    await rm(stagingDir, { recursive: true, force: true });
  }

  return manifest;
}

export async function downloadSkill(
  source: string,
  options?: SkillDownloadOptions,
): Promise<SkillDownloadResult> {
  const baseCacheDir =
    options !== undefined && options.targetDir !== undefined
      ? options.targetDir
      : join(process.cwd(), ".skills", sanitizeSkillId(source));
  const targetDir = resolve(baseCacheDir);
  const forceDownload = options !== undefined && options.force === true;

  if (!forceDownload) {
    const fresh = await isCacheFresh(
      targetDir,
      options !== undefined ? options.timeoutMs : undefined,
    );
    if (fresh) {
      const manifestFile = await findManifestFile(targetDir);
      if (manifestFile !== null) {
        const rawContent = await readFile(manifestFile, "utf-8");
        const manifest = parseSkillContent(rawContent);
        const manifestContent =
          manifest.rawContent !== undefined ? manifest.rawContent : rawContent;
        return {
          manifest,
          targetDir,
          cached: true,
          hash: computeSha256(manifestContent),
        };
      }
    }
  }

  const stagingDir = join(tmpdir(), `skill-stage-${randomUUID()}`);
  await mkdir(stagingDir, { recursive: true });

  try {
    let resolvedSourceType: SkillSourceType = "git";
    if (options !== undefined && options.sourceType !== undefined) {
      resolvedSourceType = options.sourceType;
    } else if (source.startsWith("http://") ? true : source.startsWith("https://")) {
      const isDirectGit = source.endsWith(".git")
        ? true
        : source.includes("github.com") &&
          !source.includes("raw.githubusercontent.com") &&
          !source.endsWith(".md");
      resolvedSourceType = isDirectGit ? "git" : "github-raw";
    } else if (source.startsWith("git@") ? true : source.startsWith("ssh://")) {
      resolvedSourceType = "git";
    }

    if (resolvedSourceType === "git") {
      let gitUrl = source;
      const isHttpOrSsh = source.startsWith("http://")
        ? true
        : source.startsWith("https://")
          ? true
          : source.startsWith("git@")
            ? true
            : source.startsWith("ssh://");
      if (!isHttpOrSsh) {
        gitUrl = `https://github.com/${source}.git`;
      }
      await downloadFromGit(gitUrl, stagingDir, options);
    } else {
      await downloadFromHttp(source, stagingDir, options);
    }

    const manifest = await stageAndVerifySkill(stagingDir, targetDir, options);
    const content = manifest.rawContent !== undefined ? manifest.rawContent : "";
    return {
      manifest,
      targetDir,
      cached: false,
      hash: computeSha256(content),
    };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

export class SkillDownloader {
  readonly cacheDir: string;
  readonly defaultTtlMs: number;
  readonly defaultOptions: SkillDownloadOptions;

  constructor(cacheDir?: string, defaultOptions?: SkillDownloadOptions) {
    this.cacheDir = cacheDir !== undefined ? resolve(cacheDir) : resolve(process.cwd(), ".skills");
    this.defaultTtlMs = 86400000;
    this.defaultOptions = defaultOptions !== undefined ? defaultOptions : {};
  }

  async download(source: string, options?: SkillDownloadOptions): Promise<SkillDownloadResult> {
    const mergedOptions: SkillDownloadOptions = {
      ...this.defaultOptions,
      ...options,
      targetDir:
        options !== undefined && options.targetDir !== undefined
          ? options.targetDir
          : join(this.cacheDir, sanitizeSkillId(source)),
    };
    return downloadSkill(source, mergedOptions);
  }

  async downloadFromGit(
    gitUrl: string,
    targetDir: string,
    options?: SkillDownloadOptions,
  ): Promise<string> {
    return downloadFromGit(gitUrl, targetDir, { ...this.defaultOptions, ...options });
  }

  async downloadFromHttp(
    url: string,
    targetDir: string,
    options?: SkillDownloadOptions,
  ): Promise<string> {
    return downloadFromHttp(url, targetDir, { ...this.defaultOptions, ...options });
  }

  async isCached(source: string, ttlMs?: number): Promise<boolean> {
    const targetDir = join(this.cacheDir, sanitizeSkillId(source));
    return isCacheFresh(targetDir, ttlMs !== undefined ? ttlMs : this.defaultTtlMs);
  }

  getCachedPath(source: string): string {
    return join(this.cacheDir, sanitizeSkillId(source));
  }

  async clearCache(source?: string): Promise<void> {
    if (source !== undefined && source.length > 0) {
      await rm(join(this.cacheDir, sanitizeSkillId(source)), { recursive: true, force: true });
    } else {
      await rm(this.cacheDir, { recursive: true, force: true });
    }
  }
}

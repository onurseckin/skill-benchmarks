import type { AgentToolContext } from "./types.js";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export function truncateOutput(
  output: string,
  maxBytes: number = 5242880,
): { text: string; truncated: boolean } {
  const buffer = Buffer.from(output, "utf8");
  if (buffer.byteLength <= maxBytes) return { text: output, truncated: false };
  const sliced = buffer.subarray(0, maxBytes).toString("utf8");
  return { text: `${sliced}\n...[OUTPUT TRUNCATED]...`, truncated: true };
}

export function resolveSafePath(rootPath: string, relativePath: string): string {
  const resolvedRoot = resolve(rootPath);
  const targetPath = resolve(resolvedRoot, relativePath || ".");
  const rel = relative(resolvedRoot, targetPath);
  if (
    rel === ".." ||
    rel.startsWith(".." + join("a", "b")[1]) ||
    (rel !== "" && !targetPath.startsWith(resolvedRoot))
  ) {
    throw new Error(
      `Path traversal denied: path '${relativePath}' escapes workspace root '${rootPath}'`,
    );
  }
  return targetPath;
}

export function requireLocalWorkspaceRoot(context: AgentToolContext): string {
  if (context.workspace === undefined) {
    throw new Error("Local tool execution requires an explicit workspace");
  }
  return context.workspace.rootPath;
}

function isSensitiveProviderEnvironmentName(name: string): boolean {
  return /(^|_)(KEY|API_?KEY|TOKEN|ACCESS_?TOKEN|AUTH(?:ORIZATION|_?TOKEN)?|SECRET|PASSWORD|CREDENTIALS?)(_|$)/i.test(
    name,
  );
}

export function createToolCommandEnvironment(
  explicitEnvironment: Record<string, string> | undefined,
): Record<string, string> {
  const allowedEnvironmentNames = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"];
  const environment: Record<string, string> = {};
  for (const name of allowedEnvironmentNames) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  if (explicitEnvironment === undefined) return environment;
  for (const [name, value] of Object.entries(explicitEnvironment)) {
    if (isSensitiveProviderEnvironmentName(name)) {
      throw new Error(`Sensitive environment variable '${name}' is not allowed`);
    }
    if (typeof value !== "string") {
      throw new Error(`Environment variable '${name}' must have a string value`);
    }
    environment[name] = value;
  }
  return environment;
}

export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

export async function readFileContent(
  context: AgentToolContext,
  filePath: string,
): Promise<string> {
  if (context.container) {
    const bytes = await context.container.readFile(filePath);
    return Buffer.from(bytes).toString("utf8");
  }
  const rootPath = requireLocalWorkspaceRoot(context);
  const safePath = resolveSafePath(rootPath, filePath);
  if (!existsSync(safePath)) throw new Error(`File not found: ${filePath}`);
  return readFileSync(safePath, "utf8");
}

export async function writeFileContent(
  context: AgentToolContext,
  filePath: string,
  content: string,
): Promise<void> {
  if (context.container) {
    await context.container.writeFile(filePath, content);
  } else {
    const rootPath = requireLocalWorkspaceRoot(context);
    const safePath = resolveSafePath(rootPath, filePath);
    mkdirSync(dirname(safePath), { recursive: true });
    writeFileSync(safePath, content, "utf8");
  }
}

export function collectLocalPaths(
  dirPath: string,
  rootPath: string,
  maxDepth: number,
  currentDepth: number,
): string[] {
  if (currentDepth > maxDepth) return [];
  try {
    const stats = statSync(dirPath);
    if (stats.isFile()) return [relative(rootPath, dirPath)];
    if (!stats.isDirectory()) return [];
  } catch {
    return [];
  }
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dirPath)) {
      if ([".git", "node_modules", ".benchmarks", "dist"].includes(entry)) continue;
      const full = join(dirPath, entry);
      try {
        const stats = statSync(full);
        if (stats.isDirectory()) {
          results.push(relative(rootPath, full) + "/");
          results.push(...collectLocalPaths(full, rootPath, maxDepth, currentDepth + 1));
        } else if (stats.isFile()) {
          results.push(relative(rootPath, full));
        }
      } catch {}
    }
  } catch {}
  return results;
}

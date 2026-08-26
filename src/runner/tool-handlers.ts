import type { AgentToolContext, ExecutionLimits } from "./types.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeLocalCommand, resolveToolTimeoutMs } from "./local-command-execution.js";
import {
  collectLocalPaths,
  createToolCommandEnvironment,
  globToRegex,
  readFileContent,
  requireLocalWorkspaceRoot,
  resolveSafePath,
  writeFileContent,
} from "./tool-handler-filesystem.js";

export { resolveSafePath, truncateOutput } from "./tool-handler-filesystem.js";

export interface ToolHandlerResult {
  readonly output: string;
  readonly isError: boolean;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

export async function handleRunCommand(
  args: Record<string, unknown>,
  context: AgentToolContext,
  limits?: ExecutionLimits,
): Promise<ToolHandlerResult> {
  const command = typeof args.command === "string" ? args.command : "";
  if (!command) throw new Error("Missing required argument 'command'");
  const timeoutSec = typeof args.timeout_seconds === "number" ? args.timeout_seconds : undefined;
  const timeoutMs = resolveToolTimeoutMs(limits?.toolTimeoutMs, timeoutSec);
  const envMap =
    args.env && typeof args.env === "object" ? (args.env as Record<string, string>) : undefined;
  const environment = createToolCommandEnvironment(envMap);

  if (context.container) {
    const res = await context.container.executeCommand(command, { timeoutMs, env: environment });
    const combined = [res.stdout, res.stderr].filter((s) => s.length > 0).join("\n");
    const isError = res.exitCode !== 0 || res.timedOut || res.oomKilled;
    const output = res.timedOut
      ? `${combined}\nCommand timed out after ${timeoutMs}ms`
      : res.oomKilled
        ? `${combined}\nCommand killed due to out of memory`
        : combined;
    return {
      output:
        output ||
        (isError
          ? `Command failed with exit code ${res.exitCode}`
          : "Command executed successfully with no output"),
      isError,
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
    };
  }

  const rootPath = requireLocalWorkspaceRoot(context);
  const maxBuffer = limits?.maxOutputSizeBytes ?? 5242880;
  const res = await executeLocalCommand({
    command,
    cwd: rootPath,
    timeoutMs,
    environment,
    maxOutputBytes: maxBuffer,
    signal: context.signal,
  });
  const stdout = res.stdout;
  const stderr = res.stderr;
  const exitCode = res.exitCode;
  const combined = [stdout, stderr].filter((s) => s.length > 0).join("\n");
  const isError = exitCode !== 0 || res.timedOut;
  const output = res.timedOut
    ? `${combined}${combined.length > 0 ? "\n" : ""}Command timed out after ${timeoutMs}ms`
    : combined;
  return {
    output:
      output ||
      (isError
        ? `Command failed with exit code ${exitCode}`
        : "Command executed successfully with no output"),
    isError,
    exitCode,
    stdout,
    stderr,
  };
}

export async function handleReadFile(
  args: Record<string, unknown>,
  context: AgentToolContext,
): Promise<ToolHandlerResult> {
  const filePath = typeof args.path === "string" ? args.path : "";
  if (!filePath) throw new Error("Missing required argument 'path'");
  let content = await readFileContent(context, filePath);
  const startLine = typeof args.start_line === "number" ? args.start_line : undefined;
  const endLine = typeof args.end_line === "number" ? args.end_line : undefined;
  if (startLine !== undefined || endLine !== undefined) {
    const lines = content.split("\n");
    const s = Math.max(1, startLine ?? 1) - 1;
    const e = Math.min(lines.length, endLine ?? lines.length);
    content = lines.slice(s, e).join("\n");
  }
  return { output: content, isError: false, stdout: content };
}

export async function handleWriteFile(
  args: Record<string, unknown>,
  context: AgentToolContext,
): Promise<ToolHandlerResult> {
  const filePath = typeof args.path === "string" ? args.path : "";
  if (!filePath) throw new Error("Missing required argument 'path'");
  const content = typeof args.content === "string" ? args.content : "";
  await writeFileContent(context, filePath, content);
  const msg = `Successfully wrote ${Buffer.byteLength(content, "utf8")} bytes to ${filePath}`;
  return { output: msg, isError: false, stdout: msg };
}

export async function handleEditFileContent(
  args: Record<string, unknown>,
  context: AgentToolContext,
): Promise<ToolHandlerResult> {
  const filePath = typeof args.path === "string" ? args.path : "";
  const target = typeof args.target_content === "string" ? args.target_content : "";
  const replacement = typeof args.replacement_content === "string" ? args.replacement_content : "";
  const allowMultiple = Boolean(args.allow_multiple);
  if (!filePath || !target) throw new Error("Missing required argument 'path' or 'target_content'");

  const content = await readFileContent(context, filePath);
  const startLine = typeof args.start_line === "number" ? args.start_line : undefined;
  const endLine = typeof args.end_line === "number" ? args.end_line : undefined;
  let updatedContent: string;

  if (startLine !== undefined || endLine !== undefined) {
    const lines = content.split("\n");
    const s = Math.max(1, startLine ?? 1) - 1;
    const e = Math.min(lines.length, endLine ?? lines.length);
    const before = lines.slice(0, s).join("\n");
    const chunk = lines.slice(s, e).join("\n");
    const after = lines.slice(e).join("\n");
    if (!chunk.includes(target))
      throw new Error(`Target content not found in lines ${s + 1}-${e} of ${filePath}`);
    const occurrences = chunk.split(target).length - 1;
    if (occurrences > 1 && !allowMultiple)
      throw new Error(`Target content occurs ${occurrences} times. Set allow_multiple: true.`);
    const replaced = allowMultiple
      ? chunk.replaceAll(target, replacement)
      : chunk.replace(target, replacement);
    const parts = [
      s > 0 ? before : undefined,
      replaced,
      e < lines.length ? after : undefined,
    ].filter((p): p is string => p !== undefined);
    updatedContent = parts.join("\n");
  } else {
    if (!content.includes(target)) throw new Error(`Target content not found in ${filePath}`);
    const occurrences = content.split(target).length - 1;
    if (occurrences > 1 && !allowMultiple)
      throw new Error(
        `Target content occurs ${occurrences} times in ${filePath}. Set allow_multiple: true.`,
      );
    updatedContent = allowMultiple
      ? content.replaceAll(target, replacement)
      : content.replace(target, replacement);
  }

  await writeFileContent(context, filePath, updatedContent);
  return { output: `Successfully replaced content in ${filePath}`, isError: false };
}

export async function handleListDirectory(
  args: Record<string, unknown>,
  context: AgentToolContext,
): Promise<ToolHandlerResult> {
  const dirRel = typeof args.path === "string" && args.path.length > 0 ? args.path : ".";
  const maxDepth = typeof args.max_depth === "number" && args.max_depth > 0 ? args.max_depth : 3;
  const pattern =
    typeof args.pattern === "string" && args.pattern.length > 0 ? args.pattern : undefined;

  if (context.container) {
    const patFilter = pattern ? `-name "${pattern}"` : "";
    const cmd = `find "${dirRel}" -maxdepth ${maxDepth} ${patFilter} -not -path '*/.*' -not -path '*/node_modules*' | head -n 500`;
    const res = await context.container.executeCommand(cmd, { cwd: "/workspace" });
    const output = res.stdout.trim();
    return {
      output: output || "Directory is empty",
      isError: res.exitCode !== 0,
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
    };
  }

  const rootPath = requireLocalWorkspaceRoot(context);
  const safePath = resolveSafePath(rootPath, dirRel);
  if (!existsSync(safePath)) throw new Error(`Directory not found: ${dirRel}`);
  const patternRegex = pattern ? globToRegex(pattern) : undefined;
  const entries = collectLocalPaths(safePath, rootPath, maxDepth, 1).filter(
    (e) => !patternRegex || patternRegex.test(e),
  );
  return {
    output: entries.length > 0 ? entries.join("\n") : "Directory is empty",
    isError: false,
    stdout: entries.join("\n"),
  };
}

export async function handleGrepSearch(
  args: Record<string, unknown>,
  context: AgentToolContext,
): Promise<ToolHandlerResult> {
  const query = typeof args.query === "string" ? args.query : "";
  if (!query) throw new Error("Missing required argument 'query'");
  const searchPath = typeof args.path === "string" && args.path.length > 0 ? args.path : ".";
  const isRegex = Boolean(args.is_regex);
  const caseInsensitive = Boolean(args.case_insensitive);

  if (context.container) {
    const iFlag = caseInsensitive ? "-i" : "";
    const tFlag = isRegex ? "-E" : "-F";
    const escQuery = query.replace(/"/g, '\\"');
    const cmd = `grep -rnI --exclude-dir={.git,node_modules,dist,.benchmarks} ${iFlag} ${tFlag} -e "${escQuery}" "${searchPath}" | head -n 300`;
    const res = await context.container.executeCommand(cmd, { cwd: "/workspace" });
    const isError = res.exitCode > 1;
    const output = res.stdout.trim();
    return {
      output: output || (isError ? res.stderr || "Grep search failed" : "No matches found"),
      isError,
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
    };
  }

  const rootPath = requireLocalWorkspaceRoot(context);
  const targetDir = resolveSafePath(rootPath, searchPath);
  const regex = isRegex
    ? new RegExp(query, caseInsensitive ? "i" : undefined)
    : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseInsensitive ? "i" : undefined);

  const paths = collectLocalPaths(targetDir, rootPath, 10, 1).filter((p) => !p.endsWith("/"));
  const matches: string[] = [];

  for (const relPath of paths) {
    if (matches.length >= 300) break;
    try {
      const full = resolve(rootPath, relPath);
      const content = readFileSync(full, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line !== undefined && regex.test(line)) {
          matches.push(`${relPath}:${i + 1}:${line}`);
          if (matches.length >= 300) break;
        }
      }
    } catch {}
  }

  const outStr = matches.length > 0 ? matches.join("\n") : "No matches found";
  return { output: outStr, isError: false, stdout: outStr };
}

export async function handleFindByName(
  args: Record<string, unknown>,
  context: AgentToolContext,
): Promise<ToolHandlerResult> {
  const pattern = typeof args.pattern === "string" ? args.pattern : "";
  if (!pattern) throw new Error("Missing required argument 'pattern'");
  const searchPath = typeof args.path === "string" && args.path.length > 0 ? args.path : ".";
  const maxDepth = typeof args.max_depth === "number" && args.max_depth > 0 ? args.max_depth : 10;

  if (context.container) {
    const cmd = `find "${searchPath}" -maxdepth ${maxDepth} -name "${pattern}" -not -path '*/.*' -not -path '*/node_modules*' | head -n 300`;
    const res = await context.container.executeCommand(cmd, { cwd: "/workspace" });
    const output = res.stdout.trim();
    return {
      output: output || "No files found",
      isError: res.exitCode !== 0,
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
    };
  }

  const rootPath = requireLocalWorkspaceRoot(context);
  const targetDir = resolveSafePath(rootPath, searchPath);
  const regex = globToRegex(pattern);
  const matches = collectLocalPaths(targetDir, rootPath, maxDepth, 1).filter((p) => {
    const name = p.endsWith("/")
      ? (p.slice(0, -1).split("/").pop() ?? "")
      : (p.split("/").pop() ?? "");
    return regex.test(name);
  });

  const outStr = matches.length > 0 ? matches.join("\n") : "No files found";
  return { output: outStr, isError: false, stdout: outStr };
}

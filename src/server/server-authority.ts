import { lstatSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { ServerOptions } from "./types.js";

export interface NormalizedServerOptions {
  readonly port: number;
  readonly hostname: "127.0.0.1";
  readonly dbPath: string;
  readonly outputRoot: string;
  readonly quiet: boolean;
}

export function normalizeServerOptions(options: ServerOptions): NormalizedServerOptions {
  const hostname = options.hostname ?? "127.0.0.1";
  if (hostname !== "127.0.0.1") throw invalidOptions();
  const port = options.port ?? 3000;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw invalidOptions();
  const outputRoot = requireExistingOutputRoot(options.outputRoot);
  const dbPath = requireExistingDatabase(options.dbPath, outputRoot);
  return Object.freeze({ port, hostname, dbPath, outputRoot, quiet: options.quiet === true });
}

function requireExistingOutputRoot(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw invalidOptions();
  const resolved = resolve(value);
  const stats = safeLstat(resolved);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw invalidOptions();
  return realpathSync(resolved);
}

function requireExistingDatabase(value: string, outputRoot: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw invalidOptions();
  const resolved = resolve(value);
  const stats = safeLstat(resolved);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) throw invalidOptions();
  const canonical = realpathSync(resolved);
  const relation = relative(outputRoot, canonical);
  if (relation === "" || relation === ".." || relation.startsWith("../") || relation.startsWith("..\\")) {
    throw invalidOptions();
  }
  return canonical;
}

function safeLstat(path: string): NonNullable<ReturnType<typeof lstatSync>> {
  try {
    return lstatSync(path);
  } catch {
    throw invalidOptions();
  }
}

function invalidOptions(): TypeError {
  return new TypeError("Server reader configuration is invalid");
}

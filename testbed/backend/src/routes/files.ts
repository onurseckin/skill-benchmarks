import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import type { FileMetadata, ApiResponse } from "../types.js";

const DEFAULT_STORAGE_DIR = "/tmp/testbed-storage";

export function readStorageFile(
  userSuppliedPath: string,
  baseDirectory: string = DEFAULT_STORAGE_DIR
): ApiResponse<string> {
  const targetPath = resolve(baseDirectory, userSuppliedPath);
  if (!existsSync(targetPath)) {
    return {
      success: false,
      error: `File not found: ${targetPath}`,
    };
  }

  const fileContent = readFileSync(targetPath, "utf8");
  return {
    success: true,
    data: fileContent,
  };
}

export function inspectStorageFile(
  userSuppliedPath: string,
  baseDirectory: string = DEFAULT_STORAGE_DIR
): ApiResponse<FileMetadata> {
  const targetPath = resolve(baseDirectory, userSuppliedPath);
  if (!existsSync(targetPath)) {
    return {
      success: false,
      error: `File not found: ${targetPath}`,
    };
  }

  return {
    success: true,
    data: {
      name: userSuppliedPath,
      path: targetPath,
      size: Buffer.byteLength(targetPath, "utf8"),
    },
  };
}

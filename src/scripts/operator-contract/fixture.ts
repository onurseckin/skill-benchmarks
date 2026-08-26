import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { requireCondition } from "./assertions.js";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

const credentialKeys = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
]);

export function createNoKeyEnvironment(
  temporaryRoot: string,
  overrides: Readonly<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !credentialKeys.has(key)),
  );
  environment.SKILL_BENCHMARKS_USE_MOCK = "true";
  environment.TMPDIR = temporaryRoot;
  for (const [key, value] of Object.entries(overrides)) {
    if (credentialKeys.has(key)) continue;
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
  return environment;
}

export async function withIsolatedCase(
  name: string,
  execute: (temporaryRoot: string) => Promise<void> | void,
): Promise<void> {
  const before = readCheckoutState();
  const temporaryRoot = mkdtempSync(join(tmpdir(), `skill-benchmarks-operator-${name}-`));
  let failure: unknown;
  try {
    await execute(temporaryRoot);
  } catch (error) {
    failure = error;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  const after = readCheckoutState();
  requireCondition(after === before, `checkout_changed:${name}`);
  if (failure !== undefined) throw failure;
}

export function copyTestbedFixture(temporaryRoot: string): string {
  const source = join(repositoryRoot, "testbed");
  const destination = join(temporaryRoot, "testbed");
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => {
      const fromSource = relative(source, path);
      if (fromSource === "") return true;
      return !fromSource
        .split(sep)
        .some(
          (segment) => segment === "node_modules" || segment === "dist" || segment === ".DS_Store",
        );
    },
  });
  return destination;
}

function readCheckoutState(): string {
  const result = Bun.spawnSync(
    ["git", "status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"],
    { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" },
  );
  requireCondition(result.exitCode === 0, "checkout_status_failed");
  return new TextDecoder().decode(result.stdout);
}

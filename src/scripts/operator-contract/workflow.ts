import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireCondition } from "./assertions.js";
import { repositoryRoot } from "./fixture.js";

export function verifyWorkflowCommand(): void {
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as {
    readonly scripts?: Readonly<Record<string, string>>;
  };
  requireCondition(
    packageJson.scripts?.test ===
      "bun run typecheck && bun run src/scripts/operator-contract-smoke.ts",
    "package_test_command_invalid",
  );
  const workflow = readFileSync(
    join(repositoryRoot, ".github", "workflows", "benchmark-matrix.yml"),
    "utf8",
  );
  const exactCommands = workflow
    .split(/\r?\n/)
    .filter((line) => line.trim() === "run: bun run test");
  requireCondition(exactCommands.length === 1, "workflow_test_command_invalid");
  requireCondition(!workflow.includes("start:all"), "workflow_legacy_start_present");
  requireCondition(!workflow.includes("concurrently"), "workflow_legacy_runner_present");
}

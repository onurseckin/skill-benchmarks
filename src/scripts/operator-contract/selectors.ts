import { join } from "node:path";
import { requireCondition } from "./assertions.js";
import { runSuccessfulCommand } from "./command.js";
import { createNoKeyEnvironment, repositoryRoot } from "./fixture.js";

export async function verifySelectorAdmission(temporaryRoot: string): Promise<void> {
  const environment = createNoKeyEnvironment(temporaryRoot);
  const run = await runSuccessfulCommand(
    [
      "bun",
      "run",
      "cli",
      "--",
      "run",
      "--dry-run",
      "--scenario",
      "git-worktrees",
      "--skill",
      "tdd",
      "--model",
      "gpt-4o",
      "--output-dir",
      join(temporaryRoot, "run"),
    ],
    { cwd: repositoryRoot, env: environment },
    "selector_run_failed",
  );
  requireCondition(run.stdout.includes("Sweep Complete: 1/1"), "selector_run_output_invalid");
  requireCondition(!run.stdout.includes("PASS"), "selector_run_claim_invalid");
  const arena = await runSuccessfulCommand(
    [
      "bun",
      "run",
      "cli",
      "--",
      "arena",
      "--dry-run",
      "--scenario",
      "git-worktrees",
      "--skill",
      "tdd",
      "--arena",
      "gpt-4o,claude-3-7-sonnet-20250219",
      "--output-dir",
      join(temporaryRoot, "arena"),
    ],
    { cwd: repositoryRoot, env: environment },
    "selector_arena_failed",
  );
  requireCondition(arena.stdout.includes("PLANNED PAIRING"), "selector_arena_output_invalid");
  requireCondition(arena.stdout.includes("NO BENCHMARK EXECUTED"), "selector_arena_claim_invalid");
  const tournament = await runSuccessfulCommand(
    [
      "bun",
      "run",
      "cli",
      "--",
      "tournament",
      "--dry-run",
      "--scenario",
      "git-worktrees",
      "--skill",
      "tdd",
      "--model",
      "gpt-4o,claude-3-7-sonnet-20250219",
      "--tournament-mode",
      "round-robin",
      "--output-dir",
      join(temporaryRoot, "tournament"),
    ],
    { cwd: repositoryRoot, env: environment },
    "selector_tournament_failed",
  );
  requireCondition(
    tournament.stdout.includes("PLANNED PAIRING"),
    "selector_tournament_output_invalid",
  );
  requireCondition(
    tournament.stdout.includes("NO BENCHMARK EXECUTED"),
    "selector_tournament_claim_invalid",
  );
}

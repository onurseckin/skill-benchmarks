import { requireCondition } from "./assertions.js";
import { runSuccessfulCommand } from "./command.js";
import { createNoKeyEnvironment, repositoryRoot } from "./fixture.js";

export async function verifyLocalServer(temporaryRoot: string): Promise<void> {
  const result = await runSuccessfulCommand(
    ["bun", "run", "src/scripts/server-dashboard-contract-smoke.ts"],
    {
      cwd: repositoryRoot,
      env: createNoKeyEnvironment(temporaryRoot),
      timeoutMs: 90_000,
    },
    "server_contract_failed",
  );
  requireCondition(
    result.stdout.includes("Server and dashboard contract verified."),
    "server_contract_output_invalid",
  );
}

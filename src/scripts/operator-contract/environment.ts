import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireCondition } from "./assertions.js";
import { runSuccessfulCommand } from "./command.js";
import { createNoKeyEnvironment, credentialKeys } from "./fixture.js";

export async function verifyNoKeySubprocess(temporaryRoot: string): Promise<void> {
  const dotenv = [...credentialKeys].map((key) => `${key}=forbidden`).join("\n");
  for (const name of [".env", ".env.local", ".env.test"]) {
    writeFileSync(join(temporaryRoot, name), `${dotenv}\n`);
  }
  const expression = `process.stdout.write(JSON.stringify(${JSON.stringify([...credentialKeys])}.filter((key) => process.env[key] !== undefined)))`;
  writeFileSync(join(temporaryRoot, "probe.ts"), expression);
  writeFileSync(
    join(temporaryRoot, "package.json"),
    JSON.stringify({ scripts: { probe: "bun probe.ts" } }),
  );
  const result = await runSuccessfulCommand(
    ["bun", "run", "probe"],
    { cwd: temporaryRoot, env: createNoKeyEnvironment(temporaryRoot) },
    "no_key_child_failed",
  );
  requireCondition(result.stdout === "[]", "no_key_child_inherited_credentials");
}

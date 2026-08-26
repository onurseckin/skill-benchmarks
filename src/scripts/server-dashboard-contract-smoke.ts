import { rmSync } from "node:fs";
import { requireCondition } from "./server-dashboard-contract/assertions.js";
import { createServerDashboardFixture } from "./server-dashboard-contract/fixture.js";
import { verifyHtmlSemantics } from "./server-dashboard-contract/semantics.js";
import { verifyServerContract } from "./server-dashboard-contract/server.js";

async function run(): Promise<void> {
  const fixture = createServerDashboardFixture();
  requireCondition(fixture.root.includes("skill-benchmarks-server-dashboard-"), "fixture_root_invalid");
  try {
    await verifyServerContract(fixture);
    await verifyHtmlSemantics(fixture);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
  process.stdout.write("Server and dashboard contract verified.\n");
}

run().catch(() => {
  process.stderr.write("Server and dashboard contract verification failed.\n");
  process.exit(1);
});

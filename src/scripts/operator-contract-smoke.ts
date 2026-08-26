import { verifyInvalidCli, verifyPipedCliOutput } from "./operator-contract/cli.js";
import { verifyDocumentationContract } from "./operator-contract/documentation.js";
import {
  verifyArtifactReconciliation,
  verifyNoKeyFakeRun,
} from "./operator-contract/fake-artifacts.js";
import { verifyNoKeySubprocess } from "./operator-contract/environment.js";
import { withIsolatedCase } from "./operator-contract/fixture.js";
import { verifyReplayRoundTrip, verifyReportCohorts } from "./operator-contract/replay-report.js";
import { verifyRuntimeCancellationAndPermits } from "./operator-contract/runtime-lifecycle.js";
import { verifyProviderRuntimeLifecycle } from "./operator-contract/runtime-providers.js";
import { verifyCellPermitFinalization } from "./operator-contract/runtime-cell-permits.js";
import { verifySelectorAdmission } from "./operator-contract/selectors.js";
import { verifyLocalServer } from "./operator-contract/server.js";
import { verifyScenarioCatalog, verifyStaticBoundary } from "./operator-contract/static-catalog.js";
import {
  verifyTestbedDockerLifecycle,
  verifyTestbedLocalLifecycle,
} from "./operator-contract/testbed.js";
import { verifyWorkflowCommand } from "./operator-contract/workflow.js";

interface OperatorCase {
  readonly name: string;
  readonly execute: (temporaryRoot: string) => Promise<void> | void;
}

const cases: readonly OperatorCase[] = [
  { name: "static", execute: verifyStaticBoundary },
  { name: "environment", execute: verifyNoKeySubprocess },
  { name: "catalog", execute: () => verifyScenarioCatalog() },
  { name: "selectors", execute: verifySelectorAdmission },
  { name: "fake-run", execute: verifyNoKeyFakeRun },
  { name: "runtime-providers", execute: () => verifyProviderRuntimeLifecycle() },
  { name: "runtime-lifecycle", execute: verifyRuntimeCancellationAndPermits },
  { name: "runtime-cell-permits", execute: verifyCellPermitFinalization },
  { name: "artifacts", execute: verifyArtifactReconciliation },
  { name: "cli-invalid", execute: verifyInvalidCli },
  { name: "cli-piped", execute: verifyPipedCliOutput },
  { name: "replay", execute: verifyReplayRoundTrip },
  { name: "reports", execute: verifyReportCohorts },
  { name: "server", execute: verifyLocalServer },
  { name: "testbed-local", execute: verifyTestbedLocalLifecycle },
  { name: "testbed-docker", execute: verifyTestbedDockerLifecycle },
  { name: "workflow", execute: () => verifyWorkflowCommand() },
  { name: "documentation", execute: () => verifyDocumentationContract() },
];

async function runOperatorContract(): Promise<void> {
  for (const operatorCase of cases) {
    await withIsolatedCase(operatorCase.name, operatorCase.execute);
    process.stdout.write(`Operator gate passed: ${operatorCase.name}\n`);
  }
  process.stdout.write(`Operator delivery contract verified: ${cases.length} isolated gates.\n`);
}

runOperatorContract().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Operator delivery contract failed: ${message}\n`);
  process.exit(1);
});

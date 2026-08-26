import { DiagnosticVerificationError, requireCondition } from "./ci-diagnostic/assertions.js";
import { validateDiagnosticArtifacts } from "./ci-diagnostic/artifacts.js";
import { validateDiagnosticDatabase } from "./ci-diagnostic/database.js";
import { validateDiagnosticEvents } from "./ci-diagnostic/events.js";
import { validateDiagnosticBundleFilesystem } from "./ci-diagnostic/filesystem.js";
import { validateDiagnosticReport } from "./ci-diagnostic/report.js";

export function verifyCiDiagnostic(argumentsList: readonly string[]): void {
  requireCondition(argumentsList.length === 1, "usage_requires_one_bundle");
  const bundleArgument = argumentsList[0];
  requireCondition(
    typeof bundleArgument === "string" && bundleArgument.trim().length > 0,
    "usage_requires_one_bundle",
  );
  const paths = validateDiagnosticBundleFilesystem(bundleArgument);
  const artifacts = validateDiagnosticArtifacts(paths);
  validateDiagnosticEvents(paths.events, artifacts);
  validateDiagnosticDatabase(paths.database, artifacts);
  validateDiagnosticReport(paths.report, artifacts);
}

function runVerifier(): void {
  try {
    verifyCiDiagnostic(process.argv.slice(2));
    process.stdout.write("CI diagnostic evidence verified\n");
  } catch (error) {
    const code =
      error instanceof DiagnosticVerificationError ? error.code : "verification_internal_error";
    process.stderr.write(`CI diagnostic verification failed: ${code}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) runVerifier();

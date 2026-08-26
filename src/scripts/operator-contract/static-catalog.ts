import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditMaintainedSources } from "../quality-gate/source-audit.js";
import { verifyScenarios } from "../verify-scenarios.js";
import { requireCondition } from "./assertions.js";
import { repositoryRoot } from "./fixture.js";

export function verifyStaticBoundary(temporaryRoot: string): void {
  const audit = auditMaintainedSources(repositoryRoot);
  requireCondition(audit.files.length >= 240, "static_inventory_incomplete");
  requireCondition(
    audit.files.some((path) => path.endsWith("bin/skill-benchmarks")),
    "static_bin_missing",
  );
  requireCondition(
    audit.files.some((path) => path.endsWith("testbed/Dockerfile")),
    "static_testbed_missing",
  );
  requireCondition(
    audit.files.some((path) => path.endsWith("docker/sandbox-base/exec-wrapper.sh")),
    "static_docker_missing",
  );
  requireCondition(audit.violations.length === 0, "static_violation_present");
  verifyStaticRejections(temporaryRoot);
}

export function verifyScenarioCatalog(): void {
  verifyScenarios();
}

function verifyStaticRejections(temporaryRoot: string): void {
  for (const root of ["src", "bin", "testbed", "docker"]) {
    mkdirSync(join(temporaryRoot, root), { recursive: true });
  }
  const external = join(temporaryRoot, "external.ts");
  writeFileSync(external, "export {};\n");
  symlinkSync(external, join(temporaryRoot, "src", "linked.ts"));
  writeFileSync(join(temporaryRoot, "src", "comment.mts"), "export {};\n// forbidden\n");
  writeFileSync(join(temporaryRoot, "src", "comment.cts"), "export {};\n/* forbidden */\n");
  writeFileSync(
    join(temporaryRoot, "src", "boundary.sh"),
    "#!/bin/sh\nprintf '%s\\n' '# literal'\nprintf '%s\\n' \\#escaped\ntrue;# forbidden\n",
  );
  const audit = auditMaintainedSources(temporaryRoot);
  requireCondition(audit.violations.length === 4, "static_rejection_count_invalid");
  requireCondition(
    audit.violations.some(
      (violation) =>
        violation.type === "UNSUPPORTED_SOURCE_ENTRY" && violation.file.endsWith("linked.ts"),
    ),
    "static_symlink_admitted",
  );
  for (const name of ["comment.mts", "comment.cts", "boundary.sh"]) {
    requireCondition(
      audit.violations.some(
        (violation) => violation.type === "FORBIDDEN_COMMENT" && violation.file.endsWith(name),
      ),
      `static_comment_admitted:${name}`,
    );
  }
}

import { auditMaintainedSources } from "../quality-gate/source-audit.js";
import { verifyScenarios } from "../verify-scenarios.js";
import { requireCondition } from "./assertions.js";
import { repositoryRoot } from "./fixture.js";

export function verifyStaticBoundary(): void {
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
}

export function verifyScenarioCatalog(): void {
  verifyScenarios();
}

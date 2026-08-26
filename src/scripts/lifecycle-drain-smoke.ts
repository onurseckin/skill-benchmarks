import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyContainerLifecycle } from "./operator-contract/runtime-container-lifecycle.js";

const temporaryRoot = await mkdtemp(join(tmpdir(), "skill-benchmarks-lifecycle-"));

try {
  await verifyContainerLifecycle(temporaryRoot);
  process.stdout.write("Container lifecycle drain contract verified.\n");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

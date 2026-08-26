import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ScenarioLoader } from "../runner/scenario-loader.js";

const scenariosDirectory = fileURLToPath(new URL("../../scenarios/", import.meta.url));

function collectScenarioFiles(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectScenarioFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== "catalog.json")
      files.push(entryPath);
  }
  return files;
}

export function verifyScenarios(): void {
  const loader = new ScenarioLoader(scenariosDirectory);
  const catalog = loader.loadCatalog();
  const scenarios = loader.loadAllScenarios();
  const actualFiles = new Set(collectScenarioFiles(scenariosDirectory));
  const declaredFiles = new Set(
    catalog.scenarios.map((entry) => {
      const relativePath = entry.path.startsWith("scenarios/")
        ? entry.path.slice("scenarios/".length)
        : entry.path;
      return resolve(scenariosDirectory, relativePath);
    }),
  );
  if (
    catalog.totalScenarios !== catalog.scenarios.length ||
    scenarios.length !== catalog.scenarios.length ||
    actualFiles.size !== catalog.scenarios.length ||
    declaredFiles.size !== catalog.scenarios.length ||
    [...actualFiles].some((filePath) => !declaredFiles.has(filePath))
  ) {
    throw new TypeError("Scenario catalog file inventory does not match its declaration");
  }
  process.stdout.write(`All ${scenarios.length} benchmark scenarios verified successfully.\n`);
}

if (import.meta.main) verifyScenarios();

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ScenarioLoader } from "../runner/scenario-loader.js";

function verifyScenarios(): void {
  const catalogPath = resolve(process.cwd(), "scenarios/catalog.json");
  const catalogContent = readFileSync(catalogPath, "utf8");
  const parsed = JSON.parse(catalogContent) as {
    totalScenarios: number;
    categories: readonly string[];
  };

  if (parsed.totalScenarios < 8) {
    process.stderr.write(`Expected at least 8 scenarios, found ${parsed.totalScenarios}\n`);
    process.exit(1);
  }

  const requiredCategories = ["composite", "security", "optimization"];
  for (const cat of requiredCategories) {
    if (!parsed.categories.includes(cat)) {
      process.stderr.write(`Missing required category: ${cat}\n`);
      process.exit(1);
    }
  }

  const loader = new ScenarioLoader();
  const all = loader.loadAllScenarios();
  if (all.length < 8) {
    process.stderr.write(`Loader failed to load 8 scenarios, loaded ${all.length}\n`);
    process.exit(1);
  }

  process.stdout.write("All 8 benchmark scenarios verified successfully.\n");
  process.exit(0);
}

verifyScenarios();

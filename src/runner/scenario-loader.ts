import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import type { ScenarioDefinition, ScenarioCatalog } from "./types.js";

export interface ScenarioQueryFilter {
  readonly category?: string;
  readonly difficulty?: string;
  readonly targetSkill?: string;
  readonly id?: string;
}

export class ScenarioLoader {
  private readonly scenariosDir: string;
  private readonly cache: Map<string, ScenarioDefinition>;

  constructor(scenariosDir?: string) {
    this.scenariosDir = scenariosDir !== undefined ? scenariosDir : resolve(process.cwd(), "scenarios");
    this.cache = new Map<string, ScenarioDefinition>();
  }

  loadScenario(scenarioId: string): ScenarioDefinition {
    const cached = this.cache.get(scenarioId);
    if (cached !== undefined) {
      return cached;
    }
    const foundPath = this.locateScenarioPath(scenarioId);
    if (foundPath === null) {
      throw new Error(`Scenario not found with ID: ${scenarioId}`);
    }
    const content = readFileSync(foundPath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    const validated = this.validateScenarioSchema(parsed);
    this.cache.set(scenarioId, validated);
    return validated;
  }

  loadAllScenarios(): readonly ScenarioDefinition[] {
    const catalogPath = join(this.scenariosDir, "catalog.json");
    if (existsSync(catalogPath)) {
      const catalogRaw = JSON.parse(readFileSync(catalogPath, "utf8")) as unknown;
      const catalog = catalogRaw as { readonly scenarios: readonly { readonly id: string }[] };
      return catalog.scenarios.map((entry) => this.loadScenario(entry.id));
    }
    const results: ScenarioDefinition[] = [];
    const walk = (dir: string): void => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== "catalog.json") {
          try {
            const content = readFileSync(fullPath, "utf8");
            const parsed = JSON.parse(content) as unknown;
            const scenario = this.validateScenarioSchema(parsed);
            results.push(scenario);
            this.cache.set(scenario.id, scenario);
          } catch {
          }
        }
      }
    };
    walk(this.scenariosDir);
    return results;
  }

  queryScenarios(filter: ScenarioQueryFilter): readonly ScenarioDefinition[] {
    const all = this.loadAllScenarios();
    return all.filter((s) => {
      if (filter.id !== undefined && s.id !== filter.id) {
        return false;
      }
      if (filter.category !== undefined && s.category !== filter.category) {
        return false;
      }
      if (filter.difficulty !== undefined && s.difficulty !== filter.difficulty) {
        return false;
      }
      if (filter.targetSkill !== undefined && s.targetSkill !== filter.targetSkill) {
        return false;
      }
      return true;
    });
  }

  loadCatalog(): ScenarioCatalog {
    const catalogPath = join(this.scenariosDir, "catalog.json");
    if (existsSync(catalogPath)) {
      return JSON.parse(readFileSync(catalogPath, "utf8")) as ScenarioCatalog;
    }
    const all = this.loadAllScenarios();
    const categories = Array.from(new Set(all.map((s) => s.category)));
    return {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      totalScenarios: all.length,
      categories,
      scenarios: all.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        difficulty: s.difficulty,
        targetSkill: s.targetSkill,
        path: `scenarios/${s.category}/${s.id}.json`,
        description: s.description,
      })),
    };
  }

  private locateScenarioPath(scenarioId: string): string | null {
    const directPath = join(this.scenariosDir, `${scenarioId}.json`);
    if (existsSync(directPath)) {
      return directPath;
    }
    const categories = ["coding", "frontend", "react", "debugging", "system"];
    for (const cat of categories) {
      const catPath = join(this.scenariosDir, cat, `${scenarioId}.json`);
      if (existsSync(catPath)) {
        return catPath;
      }
    }
    return null;
  }

  private validateScenarioSchema(data: unknown): ScenarioDefinition {
    if (typeof data !== "object" || data === null) {
      throw new Error("Invalid scenario schema: root must be an object");
    }
    const record = data as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id.length === 0) {
      throw new Error("Scenario missing required field: id");
    }
    if (typeof record.name !== "string" || record.name.length === 0) {
      throw new Error("Scenario missing required field: name");
    }
    if (typeof record.category !== "string") {
      throw new Error("Scenario missing required field: category");
    }
    if (typeof record.description !== "string") {
      throw new Error("Scenario missing required field: description");
    }
    if (typeof record.instructions !== "string") {
      throw new Error("Scenario missing required field: instructions");
    }
    return data as unknown as ScenarioDefinition;
  }
}

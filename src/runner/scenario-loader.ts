import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScenarioCatalog, ScenarioCatalogEntry, ScenarioDefinition } from "./types.js";

export interface ScenarioQueryFilter {
  readonly category?: string;
  readonly difficulty?: string;
  readonly targetSkill?: string;
  readonly id?: string;
}

export type ScenarioCatalogErrorCode =
  | "catalog_unavailable"
  | "catalog_invalid"
  | "catalog_duplicate"
  | "scenario_unresolved"
  | "scenario_invalid";

export class ScenarioCatalogError extends TypeError {
  readonly code: ScenarioCatalogErrorCode;

  constructor(code: ScenarioCatalogErrorCode) {
    super("Scenario catalog is invalid or the requested scenario is unavailable");
    this.name = "ScenarioCatalogError";
    this.code = code;
  }
}

const packageScenariosDirectory = fileURLToPath(new URL("../../scenarios/", import.meta.url));

export class ScenarioLoader {
  private readonly scenariosDir: string;
  private readonly cache = new Map<string, ScenarioDefinition>();
  private catalog: ScenarioCatalog | undefined;

  constructor(scenariosDir: string = packageScenariosDirectory) {
    this.scenariosDir = resolve(scenariosDir);
  }

  loadScenario(scenarioId: string): ScenarioDefinition {
    const catalog = this.loadCatalog();
    const entry = catalog.scenarios.find((value) => value.id === scenarioId);
    if (entry === undefined) throw new ScenarioCatalogError("scenario_unresolved");
    const scenario = this.cache.get(entry.id);
    if (scenario === undefined) throw new ScenarioCatalogError("scenario_invalid");
    return scenario;
  }

  loadAllScenarios(): readonly ScenarioDefinition[] {
    const catalog = this.loadCatalog();
    return Object.freeze(catalog.scenarios.map((entry) => {
      const scenario = this.cache.get(entry.id);
      if (scenario === undefined) throw new ScenarioCatalogError("scenario_invalid");
      return scenario;
    }));
  }

  queryScenarios(filter: ScenarioQueryFilter): readonly ScenarioDefinition[] {
    return this.loadAllScenarios().filter((scenario) => {
      if (filter.id !== undefined && scenario.id !== filter.id) return false;
      if (filter.category !== undefined && scenario.category !== filter.category) return false;
      if (filter.difficulty !== undefined && scenario.difficulty !== filter.difficulty) return false;
      if (filter.targetSkill !== undefined && scenario.targetSkill !== filter.targetSkill) return false;
      return true;
    });
  }

  loadCatalog(): ScenarioCatalog {
    if (this.catalog !== undefined) return this.catalog;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(resolve(this.scenariosDir, "catalog.json"), "utf8")) as unknown;
    } catch {
      throw new ScenarioCatalogError("catalog_unavailable");
    }
    const catalog = this.validateCatalogSchema(parsed);
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const entry of catalog.scenarios) {
      if (ids.has(entry.id)) throw new ScenarioCatalogError("catalog_duplicate");
      ids.add(entry.id);
      const scenarioPath = this.resolveScenarioPath(entry);
      if (paths.has(scenarioPath)) throw new ScenarioCatalogError("catalog_duplicate");
      paths.add(scenarioPath);
      const scenario = this.readScenario(scenarioPath);
      this.validateCatalogIdentity(entry, scenario);
      this.cache.set(entry.id, scenario);
    }
    const actualCategories = new Set(catalog.scenarios.map((entry) => entry.category));
    if (catalog.categories.length !== actualCategories.size
      || catalog.categories.some((category) => !actualCategories.has(category))) {
      throw new ScenarioCatalogError("catalog_invalid");
    }
    this.catalog = Object.freeze({
      ...catalog,
      categories: Object.freeze([...catalog.categories]),
      scenarios: Object.freeze([...catalog.scenarios]),
    });
    return this.catalog;
  }

  private validateCatalogSchema(data: unknown): ScenarioCatalog {
    if (typeof data !== "object" || data === null) throw new ScenarioCatalogError("catalog_invalid");
    const record = data as Record<string, unknown>;
    if (typeof record.version !== "string" || typeof record.generatedAt !== "string"
      || !Number.isSafeInteger(record.totalScenarios) || !Array.isArray(record.categories)
      || record.categories.some((value) => typeof value !== "string" || value.trim().length === 0)
      || !Array.isArray(record.scenarios) || record.totalScenarios !== record.scenarios.length) {
      throw new ScenarioCatalogError("catalog_invalid");
    }
    for (const value of record.scenarios) this.validateCatalogEntry(value);
    return data as ScenarioCatalog;
  }

  private validateCatalogEntry(data: unknown): asserts data is ScenarioCatalogEntry {
    if (typeof data !== "object" || data === null) throw new ScenarioCatalogError("catalog_invalid");
    const record = data as Record<string, unknown>;
    for (const field of ["id", "name", "category", "path", "description"] as const) {
      if (typeof record[field] !== "string" || record[field].trim().length === 0) {
        throw new ScenarioCatalogError("catalog_invalid");
      }
    }
    if (record.difficulty !== undefined && typeof record.difficulty !== "string") {
      throw new ScenarioCatalogError("catalog_invalid");
    }
    if (record.targetSkill !== undefined && typeof record.targetSkill !== "string") {
      throw new ScenarioCatalogError("catalog_invalid");
    }
  }

  private resolveScenarioPath(entry: ScenarioCatalogEntry): string {
    const normalizedPath = entry.path.replaceAll("\\", "/");
    const relativePath = normalizedPath.startsWith("scenarios/")
      ? normalizedPath.slice("scenarios/".length)
      : normalizedPath;
    const scenarioPath = resolve(this.scenariosDir, relativePath);
    const pathFromRoot = relative(this.scenariosDir, scenarioPath);
    if (relativePath.length === 0 || isAbsolute(relativePath) || pathFromRoot === ".."
      || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
      throw new ScenarioCatalogError("scenario_invalid");
    }
    try {
      if (!lstatSync(scenarioPath).isFile()) throw new ScenarioCatalogError("scenario_invalid");
    } catch (error) {
      if (error instanceof ScenarioCatalogError) throw error;
      throw new ScenarioCatalogError("scenario_invalid");
    }
    return scenarioPath;
  }

  private readScenario(scenarioPath: string): ScenarioDefinition {
    try {
      return this.validateScenarioSchema(JSON.parse(readFileSync(scenarioPath, "utf8")) as unknown);
    } catch (error) {
      if (error instanceof ScenarioCatalogError) throw error;
      throw new ScenarioCatalogError("scenario_invalid");
    }
  }

  private validateCatalogIdentity(entry: ScenarioCatalogEntry, scenario: ScenarioDefinition): void {
    if (entry.id !== scenario.id || entry.category !== scenario.category
      || (entry.difficulty !== undefined && entry.difficulty !== scenario.difficulty)
      || (entry.targetSkill !== undefined && entry.targetSkill !== scenario.targetSkill)) {
      throw new ScenarioCatalogError("scenario_invalid");
    }
  }

  private validateScenarioSchema(data: unknown): ScenarioDefinition {
    if (typeof data !== "object" || data === null) throw new ScenarioCatalogError("scenario_invalid");
    const record = data as Record<string, unknown>;
    for (const field of ["id", "name", "category", "difficulty", "description", "instructions"] as const) {
      if (typeof record[field] !== "string" || record[field].trim().length === 0) {
        throw new ScenarioCatalogError("scenario_invalid");
      }
    }
    if (record.targetSkill !== undefined && (typeof record.targetSkill !== "string" || record.targetSkill.trim().length === 0)) {
      throw new ScenarioCatalogError("scenario_invalid");
    }
    return data as ScenarioDefinition;
  }
}

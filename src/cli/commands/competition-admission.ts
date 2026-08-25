import { join, relative, resolve, sep } from "node:path";
import { getModelDefinition } from "../../models/model-registry.js";
import { resolveBenchmarkRuntimeConfig, type BenchmarkRuntimeConfig } from "../../shared/benchmark-runtime-config.js";
import { BenchmarkAdmissionError, validateMatrixSweepConfig } from "../../sweep/sweep-config-validation.js";
import type { MatrixSweepConfig, ModelMatrixEntry } from "../../sweep/types.js";

export interface CompetitionAdmissionInput {
  readonly scenarioIds: readonly string[];
  readonly skillIds: readonly string[];
  readonly modelIds: readonly string[];
  readonly minimumModels: number;
  readonly maximumModels?: number;
  readonly dryRun: boolean;
  readonly mock?: boolean;
  readonly live?: boolean;
  readonly outputDir?: string;
  readonly dbPath?: string;
}

export interface CompetitionAdmission {
  readonly runtimeConfig: BenchmarkRuntimeConfig;
  readonly scenarioIds: readonly string[];
  readonly skillId: string;
  readonly models: readonly ModelMatrixEntry[];
  readonly dryRun: boolean;
  readonly telemetryDbPath: string;
}

export function admitCompetition(input: CompetitionAdmissionInput): CompetitionAdmission {
  const runtimeConfig = resolveBenchmarkRuntimeConfig({
    mock: input.mock,
    live: input.live,
    outputDir: input.outputDir,
  });
  if (input.scenarioIds.length === 0) throw new BenchmarkAdmissionError("scenario_unresolved");
  if (input.skillIds.length !== 1) throw new BenchmarkAdmissionError("skill_unresolved");
  if (input.modelIds.length < input.minimumModels
    || (input.maximumModels !== undefined && input.modelIds.length > input.maximumModels)) {
    throw new BenchmarkAdmissionError("empty_matrix");
  }
  const models = input.modelIds.map(resolveModelEntry);
  const telemetryDbPath = requirePathInsideRoot(
    input.dbPath ?? join(runtimeConfig.outputRoot, "db", "benchmarks.sqlite"),
    runtimeConfig.outputRoot
  );
  const matrixConfig: MatrixSweepConfig = {
    runtimeConfig,
    scenarioIds: [...input.scenarioIds],
    skillIds: [...input.skillIds],
    models,
    repetitions: 1,
    concurrency: { maxGlobalConcurrency: Math.min(models.length, 4) },
    telemetryDbPath,
  };
  validateMatrixSweepConfig(matrixConfig);
  return Object.freeze({
    runtimeConfig: Object.freeze({ ...runtimeConfig }),
    scenarioIds: Object.freeze([...input.scenarioIds]),
    skillId: input.skillIds[0] as string,
    models: Object.freeze(models.map((model) => Object.freeze({ ...model }))),
    dryRun: input.dryRun,
    telemetryDbPath,
  });
}

export function toCompetitionSweepConfig(
  admission: CompetitionAdmission,
  scenarioIds: readonly string[],
  models: readonly ModelMatrixEntry[]
): MatrixSweepConfig {
  const config: MatrixSweepConfig = {
    runtimeConfig: admission.runtimeConfig,
    scenarioIds,
    skillIds: [admission.skillId],
    models,
    repetitions: 1,
    concurrency: { maxGlobalConcurrency: Math.min(models.length, 4) },
    telemetryDbPath: admission.telemetryDbPath,
  };
  validateMatrixSweepConfig(config);
  return config;
}

function resolveModelEntry(modelId: string): ModelMatrixEntry {
  const definition = getModelDefinition(modelId);
  if (definition === undefined) throw new BenchmarkAdmissionError("model_unresolved");
  return { modelId, providerId: definition.provider };
}

function requirePathInsideRoot(path: string, root: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  const fromRoot = relative(resolvedRoot, resolvedPath);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new TypeError("Benchmark database path must be inside the output root");
  }
  return resolvedPath;
}

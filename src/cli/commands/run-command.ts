import { join } from "node:path";
import { getModelDefinition } from "../../models/model-registry.js";
import { ScenarioLoader } from "../../runner/scenario-loader.js";
import { resolveBenchmarkRuntimeConfig } from "../../shared/benchmark-runtime-config.js";
import { MatrixSweepEngine } from "../../sweep/sweep-engine.js";
import {
  BenchmarkAdmissionError,
  validateMatrixSweepConfig,
} from "../../sweep/sweep-config-validation.js";
import type { MatrixSweepConfig } from "../../sweep/types.js";
import { cyan, formatBadge, formatSectionHeader } from "../formatter.js";
import type { BenchmarkRunOptions, CliCommandResult, CliParsedArgs } from "../types.js";

export async function runBenchmarkCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.benchmarkOptions ?? ({} as BenchmarkRunOptions);
  const runtimeConfig = resolveBenchmarkRuntimeConfig({
    mock: options.mock,
    live: options.live,
    outputDir: options.outputDir,
    providerId: options.providerId,
  });
  const scenarioIds = resolveScenarioIds(options);
  if (options.skillIds.length === 0) throw new BenchmarkAdmissionError("skill_unresolved");
  const skillIds = [...options.skillIds];
  const modelIds = options.modelIds.length > 0
    ? [...options.modelIds]
    : ["claude-3-7-sonnet-20250219"];
  const models = modelIds.map((modelId) => {
    const definition = getModelDefinition(modelId);
    if (definition === undefined) throw new BenchmarkAdmissionError("model_unresolved");
    return {
      modelId,
      providerId: definition.provider,
      temperature: options.temperature,
      thinkingLevel: options.thinking ?? definition.defaultThinkingLevel,
      thinkingBudget: options.thinkingBudget,
      reasoningEffort: options.reasoning,
    };
  });
  const sweepConfig: MatrixSweepConfig = {
    scenarioIds,
    skillIds,
    models,
    thinkingLevels: options.matrixThinking,
    repetitions: options.repetitions ?? 1,
    dryRun: options.dryRun,
    defaultExecutionLimits: {
      ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
      ...(options.maxCostUSD === undefined ? {} : { maxCostUSD: options.maxCostUSD }),
      ...(options.timeoutSeconds === undefined ? {} : { maxWallClockTimeMs: options.timeoutSeconds * 1000 }),
    },
    concurrency: { maxGlobalConcurrency: options.concurrency ?? 4 },
    telemetryDbPath: options.dbPath ?? join(runtimeConfig.outputRoot, "db", "benchmarks.sqlite"),
    runtimeConfig,
  };
  validateMatrixSweepConfig(sweepConfig);
  console.log(formatSectionHeader(`Executing Skill Benchmark Matrix: ${scenarioIds.length} scenario(s) x ${skillIds.length} skill(s) x ${modelIds.length} model(s)`));
  const engine = new MatrixSweepEngine();
  engine.on((event) => {
    if (event.type === "cell:complete") {
      const evaluated = event.payload?.eligibilityStatus === "eligible" && typeof event.payload.passedBenchmark === "boolean";
      const passedBenchmark = evaluated && event.payload?.passedBenchmark === true;
      const label = evaluated ? (passedBenchmark ? "PASS" : "EVALUATED") : "COMPLETE";
      console.log(`  ${formatBadge(passedBenchmark ? "success" : "info", label)} ${cyan(event.cellId ?? "")} | ${event.message}`);
    } else if (event.type === "cell:error") {
      console.log(`  ${formatBadge("error", "FAIL")} ${cyan(event.cellId ?? "")} | ${event.message}`);
    }
  });
  const summary = await engine.run(sweepConfig);
  const terminalLabel = summary.status === "completed" ? "Complete" : summary.status === "aborted" ? "Aborted" : "Failed";
  console.log(formatSectionHeader(`Sweep ${terminalLabel}: ${summary.completedCount}/${summary.completedCount + summary.failedCount} completed in ${(summary.totalDurationMs / 1000).toFixed(1)}s`));
  const success = summary.status === "completed" && summary.failedCount === 0;
  return { success, exitCode: success ? 0 : 1, durationMs: Date.now() - startTime, data: summary };
}

function resolveScenarioIds(options: BenchmarkRunOptions): readonly string[] {
  const loader = new ScenarioLoader();
  if (options.scenarioIds.length > 0) {
    const scenarioIds = [...options.scenarioIds];
    if (options.category !== undefined) {
      for (const scenarioId of scenarioIds) {
        if (loader.loadScenario(scenarioId).category !== options.category) {
          throw new BenchmarkAdmissionError("scenario_unresolved");
        }
      }
    }
    return scenarioIds;
  }
  if (options.category === undefined) return ["git-worktrees"];
  const matches = loader.queryScenarios({ category: options.category });
  if (matches.length === 0) throw new BenchmarkAdmissionError("scenario_unresolved");
  return matches.map((scenario) => scenario.id);
}

import { preflightReportOutputPaths, publishReportOutputs } from "../../reporting/report-output.js";
import { ArenaRunner, type ArenaPairing } from "../../runner/arena-runner.js";
import { cyan, formatBadge, formatSectionHeader } from "../formatter.js";
import type { ArenaCliOptions, CliCommandResult, CliParsedArgs } from "../types.js";
import { admitCompetition, toCompetitionSweepConfig } from "./competition-admission.js";

export async function runArenaCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startedAt = Date.now();
  const options = args.arenaOptions ?? ({} as ArenaCliOptions);
  if (options.scenarioIds?.length !== 1) throw new TypeError("Arena requires exactly one admitted scenario");
  const admission = admitCompetition({
    scenarioIds: options.scenarioIds ?? [],
    skillIds: options.skillId === undefined ? [] : [options.skillId],
    modelIds: options.arenaModels ?? [],
    minimumModels: 2,
    maximumModels: 2,
    dryRun: options.dryRun ?? false,
    mock: options.mock,
    live: options.live,
    outputDir: options.outputDir,
    dbPath: options.dbPath,
  });
  const modelA = admission.models[0] as { readonly modelId: string; readonly providerId: string };
  const modelB = admission.models[1] as { readonly modelId: string; readonly providerId: string };
  if (options.outputPath !== undefined) {
    preflightReportOutputPaths([options.outputPath], [admission.telemetryDbPath]);
  }
  const pairing: ArenaPairing = Object.freeze({
    scenarioId: admission.scenarioIds[0] as string,
    skillId: admission.skillId,
    modelA: modelA.modelId,
    modelB: modelB.modelId,
    providerA: modelA.providerId,
    providerB: modelB.providerId,
  });
  const result = await new ArenaRunner().runBattle({
    pairing,
    dryRun: admission.dryRun,
    executionMode: admission.runtimeConfig.executionMode,
    ...(admission.dryRun || admission.runtimeConfig.executionMode === "live"
      ? {}
      : { sweepConfig: toCompetitionSweepConfig(admission, [pairing.scenarioId], admission.models) }),
  });
  console.log(formatSectionHeader(`Arena Candidate Comparison: ${pairing.modelA} and ${pairing.modelB}`));
  if (result.status === "planned") {
    console.log(`  ${formatBadge("info", "PLANNED PAIRING")} ${pairing.scenarioId} / ${pairing.skillId}`);
    console.log("  NO BENCHMARK EXECUTED");
  } else {
    console.log(`  ${formatBadge(result.status === "failed" ? "error" : "info", result.displayStatus)} ${result.reason}`);
  }
  if (options.outputPath !== undefined) {
    publishReportOutputs(
      [{ path: options.outputPath, content: `${JSON.stringify(result, null, 2)}\n` }],
      [admission.telemetryDbPath]
    );
    console.log(`  ${formatBadge("success", "EXPORT")} Arena diagnostic saved to ${cyan(options.outputPath)}`);
  }
  const success = result.status !== "failed" && result.status !== "not_evaluated";
  return {
    success,
    exitCode: success ? 0 : 1,
    durationMs: Date.now() - startedAt,
    data: result,
  };
}

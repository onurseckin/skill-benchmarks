import { preflightReportOutputPaths, publishReportOutputs } from "../../reporting/report-output.js";
import { TournamentScheduler } from "../../runner/tournament-scheduler.js";
import { createTournamentPlan, type TournamentPairing } from "../../runner/tournament-planner.js";
import { cyan, formatBadge, formatSectionHeader } from "../formatter.js";
import type { CliCommandResult, CliParsedArgs, TournamentOptions } from "../types.js";
import { admitCompetition, toCompetitionSweepConfig } from "./competition-admission.js";

export async function runTournamentCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startedAt = Date.now();
  const options = args.tournamentOptions ?? ({} as TournamentOptions);
  const admission = admitCompetition({
    scenarioIds: options.scenarioIds,
    skillIds: options.skillIds,
    modelIds: options.modelIds ?? [],
    minimumModels: 2,
    dryRun: options.dryRun ?? false,
    mock: options.mock,
    live: options.live,
    outputDir: options.outputDir,
    dbPath: options.dbPath,
  });
  const plan = createTournamentPlan({
    mode: options.tournamentMode ?? (admission.models.length > 6 ? "swiss" : "round-robin"),
    models: admission.models.map((model) => ({ modelId: model.modelId, providerId: model.providerId })),
    scenarios: admission.scenarioIds,
    skillId: admission.skillId,
    rounds: options.rounds,
    maxMatches: options.maxMatches,
  });
  if (options.outputPath !== undefined) {
    preflightReportOutputPaths([options.outputPath], [admission.telemetryDbPath]);
  }
  const result = await new TournamentScheduler().runTournament({
    plan,
    dryRun: admission.dryRun,
    executionMode: admission.runtimeConfig.executionMode,
    ...(admission.dryRun || admission.runtimeConfig.executionMode === "live"
      ? {}
      : { createSweepConfig: (pairing: TournamentPairing) => createPairingSweepConfig(admission, pairing) }),
  });
  console.log(formatSectionHeader(`Tournament Comparison Schedule: ${plan.mode.toUpperCase()}`));
  if (result.status === "planned") {
    for (const pairing of result.pairings) {
      console.log(`  ${formatBadge("info", "PLANNED PAIRING")} round ${pairing.roundNumber}: ${pairing.modelA} and ${pairing.modelB}`);
    }
    for (const bye of result.plannedByes) {
      console.log(`  ${formatBadge("neutral", "PLANNED BYE")} round ${bye.roundNumber}: ${bye.modelId}`);
    }
    console.log("  NO BENCHMARK EXECUTED");
  } else {
    console.log(`  ${formatBadge(result.status === "failed" ? "error" : "info", result.displayStatus)} ${result.reason}`);
  }
  if (options.outputPath !== undefined) {
    publishReportOutputs(
      [{ path: options.outputPath, content: `${JSON.stringify(result, null, 2)}\n` }],
      [admission.telemetryDbPath]
    );
    console.log(`  ${formatBadge("success", "EXPORT")} Tournament diagnostic saved to ${cyan(options.outputPath)}`);
  }
  const success = result.status !== "failed" && result.status !== "not_evaluated";
  return {
    success,
    exitCode: success ? 0 : 1,
    durationMs: Date.now() - startedAt,
    data: result,
  };
}

function createPairingSweepConfig(
  admission: ReturnType<typeof admitCompetition>,
  pairing: TournamentPairing
) {
  const models = admission.models.filter((model) => model.modelId === pairing.modelA || model.modelId === pairing.modelB);
  if (models.length !== 2) throw new TypeError("Tournament pairing models are unavailable");
  return toCompetitionSweepConfig(admission, [pairing.scenarioId], models);
}

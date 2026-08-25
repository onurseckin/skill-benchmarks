import { preflightReportOutputPaths, publishReportOutputs } from "../../reporting/report-output.js";
import { TournamentScheduler } from "../../runner/tournament-scheduler.js";
import { createTournamentPlan, type TournamentPairing } from "../../runner/tournament-planner.js";
import { formatBadge, formatSectionHeader } from "../formatter.js";
import type { CliCommandResult, CliOutput, CliParsedArgs, TournamentOptions } from "../types.js";
import { admitCompetition, toCompetitionSweepConfig } from "./competition-admission.js";

export async function runTournamentCommand(
  args: CliParsedArgs,
  output: CliOutput
): Promise<CliCommandResult> {
  const startedAt = Date.now();
  const options = requireOptions(args.tournamentOptions);
  const admission = admitCompetition({
    scenarioIds: options.scenarioIds,
    skillIds: options.skillIds,
    modelIds: options.modelIds,
    minimumModels: 2,
    dryRun: options.dryRun ?? false,
    mock: options.mock,
    live: options.live,
    outputDir: options.outputDir,
  });
  const plan = createTournamentPlan({
    mode: options.tournamentMode ?? (admission.models.length > 6 ? "swiss" : "round-robin"),
    models: admission.models.map((model) => ({ modelId: model.modelId, providerId: model.providerId })),
    scenarios: admission.scenarioIds,
    skillId: admission.skillId,
    rounds: options.rounds,
  });
  if (options.outputPath !== undefined) preflightReportOutputPaths([options.outputPath], [admission.telemetryDbPath]);
  const result = await new TournamentScheduler().runTournament({
    plan,
    dryRun: admission.dryRun,
    executionMode: admission.runtimeConfig.executionMode,
    ...(admission.dryRun || admission.runtimeConfig.executionMode === "live"
      ? {}
      : { createSweepConfig: (pairing: TournamentPairing) => createPairingSweepConfig(admission, pairing) }),
  });
  output.stdout(`${formatSectionHeader(`Tournament Comparison Schedule: ${plan.mode.toUpperCase()}`)}\n`);
  if (result.status === "planned") {
    for (const pairing of result.pairings) {
      output.stdout(`  ${formatBadge("info", "PLANNED PAIRING")} round ${pairing.roundNumber}: ${pairing.modelA} and ${pairing.modelB}\n`);
    }
    for (const bye of result.plannedByes) {
      output.stdout(`  ${formatBadge("neutral", "PLANNED BYE")} round ${bye.roundNumber}: ${bye.modelId}\n`);
    }
    output.stdout("  NO BENCHMARK EXECUTED\n");
  } else {
    output.stdout(`  ${formatBadge(result.status === "failed" ? "error" : "info", result.displayStatus)} ${result.reason}\n`);
  }
  const success = result.status !== "failed" && result.status !== "not_evaluated";
  if (success && options.outputPath !== undefined) {
    publishReportOutputs([{ path: options.outputPath, content: `${JSON.stringify(result, null, 2)}\n` }], [admission.telemetryDbPath]);
    output.stderr("Tournament diagnostic written.\n");
  }
  return { success, exitCode: success ? 0 : 1, durationMs: Date.now() - startedAt, data: result };
}

function createPairingSweepConfig(
  admission: ReturnType<typeof admitCompetition>,
  pairing: TournamentPairing
) {
  const models = admission.models.filter((model) => model.modelId === pairing.modelA || model.modelId === pairing.modelB);
  if (models.length !== 2) throw new TypeError("Tournament pairing models are unavailable");
  return toCompetitionSweepConfig(admission, [pairing.scenarioId], models);
}

function requireOptions(options: TournamentOptions | undefined): TournamentOptions {
  if (options === undefined) throw new TypeError("Tournament options are unavailable");
  return options;
}

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  CliParsedArgs,
  CliCommandResult,
  ArenaCliOptions,
} from "./types.js";
import {
  bold,
  green,
  red,
  cyan,
  yellow,
  formatSectionHeader,
  formatBadge,
} from "./formatter.js";
import { ArenaRunner } from "../runner/arena-runner.js";
import { TelemetryDatabase } from "../reporting/db.js";

export async function runArenaCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startTime = Date.now();
  const options = args.arenaOptions ?? ({} as ArenaCliOptions);
  const benchmarkOpts = args.benchmarkOptions;

  const scenarioIds = options.scenarioIds && options.scenarioIds.length > 0
    ? options.scenarioIds
    : benchmarkOpts?.scenarioIds && benchmarkOpts.scenarioIds.length > 0
    ? benchmarkOpts.scenarioIds
    : ["git-worktrees"];
  const scenarioId = scenarioIds[0] ?? "git-worktrees";

  const arenaModels = options.arenaModels && options.arenaModels.length >= 2
    ? options.arenaModels
    : benchmarkOpts?.arena && benchmarkOpts.arena.length >= 2
    ? benchmarkOpts.arena
    : ["claude-3-7-sonnet", "o3-mini"];

  const modelA = arenaModels[0] ?? "claude-3-7-sonnet";
  const modelB = arenaModels[1] ?? "o3-mini";
  const dbPath = options.dbPath ?? benchmarkOpts?.dbPath ?? resolve(process.cwd(), "benchmarks.db");
  const dryRun = options.dryRun ?? benchmarkOpts?.dryRun ?? false;

  const db = new TelemetryDatabase(dbPath);
  try {
    db.initSchema();
  } catch {}

  const eloLeaderboard = db.getEloLeaderboard();
  const entryA = eloLeaderboard.find((e) => e.skillId === modelA);
  const entryB = eloLeaderboard.find((e) => e.skillId === modelB);
  const initialRatingA = entryA ? Math.round(entryA.rating) : 1500;
  const initialRatingB = entryB ? Math.round(entryB.rating) : 1500;

  console.log(
    formatSectionHeader(
      `Head-to-Head Arena Battle: ${modelA} (Elo: ${initialRatingA}) vs ${modelB} (Elo: ${initialRatingB}) [Scenario: ${scenarioId}]`
    )
  );

  const runner = new ArenaRunner();
  const battleResult = await runner.runBattle({
    scenarioId,
    modelA,
    modelB,
    judgeModelId: options.judgeModelId ?? benchmarkOpts?.judgeModelId ?? "claude-3-7-sonnet",
    judgeProviderId: options.judgeProviderId,
    kFactor: options.kFactor ?? 32,
    initialRatingA,
    initialRatingB,
    dryRun,
  });

  const deltaStrA = battleResult.deltaA >= 0 ? `+${battleResult.deltaA}` : `${battleResult.deltaA}`;
  const deltaStrB = battleResult.deltaB >= 0 ? `+${battleResult.deltaB}` : `${battleResult.deltaB}`;

  console.log("\n─── Arena Battle Verdict ─────────────────────────────────────────");
  if (battleResult.winner === "model_a") {
    console.log(`  ${formatBadge("success", "WINNER")} Model A: ${bold(green(modelA))}`);
  } else if (battleResult.winner === "model_b") {
    console.log(`  ${formatBadge("success", "WINNER")} Model B: ${bold(green(modelB))}`);
  } else {
    console.log(`  ${formatBadge("warning", "DRAW")} Outcome: ${bold(yellow("Tie / Stalemate"))}`);
  }

  console.log(`\n  Bradley-Terry Elo Rating Updates (K=${options.kFactor ?? 32}):`);
  console.log(`    - ${bold(modelA.padEnd(24))} ${battleResult.preRatingA} -> ${bold(String(battleResult.postRatingA))} (${cyan(deltaStrA)})`);
  console.log(`    - ${bold(modelB.padEnd(24))} ${battleResult.preRatingB} -> ${bold(String(battleResult.postRatingB))} (${cyan(deltaStrB)})`);

  console.log(`\n  Judge Confidence: ${(battleResult.confidenceScore * 100).toFixed(1)}% | Position Bias: ${battleResult.positionBiasDetected ? red("DETECTED") : green("CLEAN")}`);
  if (battleResult.rationale) {
    console.log(`  Rationale: ${battleResult.rationale}`);
  }
  console.log(`  Duration: ${(battleResult.totalDurationMs / 1000).toFixed(2)}s`);
  console.log("──────────────────────────────────────────────────────────────────\n");

  if (options.outputPath || benchmarkOpts?.outputPath) {
    const dest = options.outputPath ?? benchmarkOpts?.outputPath ?? resolve(process.cwd(), "arena-battle.json");
    writeFileSync(dest, JSON.stringify(battleResult, null, 2), "utf8");
    console.log(`  ${formatBadge("success", "EXPORT")} Battle artifact saved to ${cyan(dest)}`);
  }

  return {
    success: true,
    exitCode: 0,
    durationMs: Date.now() - startTime,
    data: battleResult,
  };
}

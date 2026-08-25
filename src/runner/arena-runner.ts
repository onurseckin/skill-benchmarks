import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ScenarioRunnerEngine } from "./runner-engine.js";
import { ScenarioLoader } from "./scenario-loader.js";
import { createProviderAdapter } from "../providers/factory.js";
import { BlindPairwiseEloEngine } from "../eval/pairwise-elo.js";
import { getOrCreateModelDefinition } from "../models/index.js";
import type { ExecutionLimits, ScenarioResult, ScenarioDefinition } from "./types.js";
import type { IContainerPoolManager, IContainerInstance } from "../infrastructure/container/types.js";
import type { PairwiseCandidate } from "../eval/types.js";
import type { TelemetryDatabase } from "../reporting/db.js";

export interface ArenaBattleMatchConfig {
  readonly matchId?: string;
  readonly scenarioId: string;
  readonly skillId?: string;
  readonly modelA: string;
  readonly modelB: string;
  readonly providerA?: string;
  readonly providerB?: string;
  readonly judgeModelId?: string;
  readonly judgeProviderId?: string;
  readonly juryModelIds?: readonly string[];
  readonly limits?: Partial<ExecutionLimits>;
  readonly containerPool?: IContainerPoolManager;
  readonly dryRun?: boolean;
  readonly kFactor?: number;
  readonly initialRatingA?: number;
  readonly initialRatingB?: number;
  readonly temperatureA?: number;
  readonly temperatureB?: number;
  readonly thinkingA?: "none" | "low" | "medium" | "high" | "max";
  readonly thinkingB?: "none" | "low" | "medium" | "high" | "max";
  readonly dbPath?: string;
  readonly telemetryDb?: TelemetryDatabase;
}

export interface ArenaBattleResult {
  readonly matchId: string;
  readonly scenarioId: string;
  readonly skillId: string;
  readonly modelA: string;
  readonly modelB: string;
  readonly resultA: ScenarioResult;
  readonly resultB: ScenarioResult;
  readonly winner: "model_a" | "model_b" | "tie";
  readonly scoreA: number;
  readonly scoreB: number;
  readonly preRatingA: number;
  readonly preRatingB: number;
  readonly postRatingA: number;
  readonly postRatingB: number;
  readonly deltaA: number;
  readonly deltaB: number;
  readonly rationale: string;
  readonly confidenceScore: number;
  readonly positionBiasDetected: boolean;
  readonly totalDurationMs: number;
  readonly timestamp: string;
}

export interface ArenaTournamentConfig {
  readonly modelIds: readonly string[];
  readonly scenarioIds: readonly string[];
  readonly skillId?: string;
  readonly judgeModelId?: string;
  readonly judgeProviderId?: string;
  readonly kFactor?: number;
  readonly initialRating?: number;
  readonly dryRun?: boolean;
  readonly containerPool?: IContainerPoolManager;
}

export interface ArenaTournamentResult {
  readonly matches: readonly ArenaBattleResult[];
  readonly ratings: Readonly<Record<string, number>>;
  readonly winStats: Readonly<Record<string, { readonly wins: number; readonly losses: number; readonly draws: number; readonly winRate: number }>>;
  readonly totalMatches: number;
  readonly totalDurationMs: number;
}

export class ArenaRunner {
  private readonly scenarioLoader: ScenarioLoader;
  private readonly runnerEngine: ScenarioRunnerEngine;

  constructor(scenarioLoader?: ScenarioLoader, runnerEngine?: ScenarioRunnerEngine) {
    this.scenarioLoader = scenarioLoader ?? new ScenarioLoader();
    this.runnerEngine = runnerEngine ?? new ScenarioRunnerEngine();
  }

  private buildSyntheticResult(runId: string, scenarioId: string, skillId: string, modelId: string, durationMs: number): ScenarioResult {
    return {
      runId, scenarioId, skillIds: [skillId], modelId,
      terminationReason: "success", completed: true, turns: 3, turnHistory: [], toolHistory: [], messages: [],
      finalOutput: `Synthetic solution produced by ${modelId} for ${scenarioId}`,
      totalDurationMs: durationMs,
      totalTokens: { inputTokens: 1200, outputTokens: 450, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, totalTokens: 1650 },
      totalCostUSD: 0.0055, consecutiveToolErrors: 0,
      startedAt: new Date(Date.now() - durationMs).toISOString(), finishedAt: new Date().toISOString(),
    };
  }

  private async executeModelTrial(
    runId: string,
    scenario: ScenarioDefinition,
    skillId: string,
    modelId: string,
    providerIdOverride: string | undefined,
    temperature: number | undefined,
    thinkingLevel: ("none" | "low" | "medium" | "high" | "max") | undefined,
    limits: ExecutionLimits,
    containerPool: IContainerPoolManager | undefined,
    dryRun: boolean | undefined
  ): Promise<{ result: ScenarioResult; diff: string }> {
    if (dryRun) {
      const simDuration = 60 + Math.floor(Math.random() * 80);
      const res = this.buildSyntheticResult(runId, scenario.id, skillId, modelId, simDuration);
      const diff = `--- /dev/null\n+++ b/solution.ts\n@@ -0,0 +1,5 @@\n+export const ${modelId.replace(/[^a-zA-Z0-9]/g, "_")} = true;\n`;
      return { result: res, diff };
    }

    let container: IContainerInstance | undefined;
    if (containerPool) {
      container = await containerPool.acquire({
        imageTag: "skill-benchmarks-sandbox:latest",
        runId,
        scenarioId: scenario.id,
        resourceLimits: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
        networkMode: "sb-bridge-isolated",
        workspaceVolumeName: `sb-vol-${runId}`,
        artifactHostPath: resolve(process.cwd(), `.benchmarks/artifacts/${runId}`),
        timeouts: {
          commandTimeoutMs: limits.toolTimeoutMs,
          turnTimeoutMs: 60000,
          totalScenarioTimeoutMs: limits.maxWallClockTimeMs,
        },
        labels: { "io.skill-benchmarks.arena-run": runId },
      });
    }

    try {
      const def = getOrCreateModelDefinition(modelId);
      const effectiveProvider = providerIdOverride ?? def.provider;
      const provider = createProviderAdapter({
        providerId: (effectiveProvider as "anthropic" | "google" | "openai" | "ollama" | "custom") || "anthropic",
        defaultModel: modelId,
      });

      const result = await this.runnerEngine.run({
        runId, scenarioId: scenario.id, skillIds: [skillId], modelId, provider,
        prompt: scenario.instructions, container, limits, temperature,
        thinkingLevel: thinkingLevel ?? def.defaultThinkingLevel,
      });

      let diff = "";
      for (const t of result.toolHistory) {
        if (t.output && (t.output.includes("diff --git") || t.output.includes("--- a/"))) {
          diff += t.output + "\n";
        }
      }
      return { result, diff: diff || result.finalOutput };
    } finally {
      if (container && containerPool) await containerPool.release(container);
    }
  }

  public async runBattle(config: ArenaBattleMatchConfig): Promise<ArenaBattleResult> {
    const startTime = performance.now();
    const matchId = config.matchId ?? randomUUID();
    const scenario = this.scenarioLoader.loadScenario(config.scenarioId);
    const skillId = config.skillId ?? scenario.targetSkill ?? "generic-agent";

    const limits: ExecutionLimits = {
      maxTurns: 10, maxWallClockTimeMs: 120000, maxCostUSD: 1.0,
      maxConsecutiveToolFailures: 3, toolTimeoutMs: 30000, maxOutputSizeBytes: 1024 * 1024,
      ...config.limits,
    };

    const runIdA = `arena-${matchId}-A-${config.modelA}`;
    const runIdB = `arena-${matchId}-B-${config.modelB}`;

    const [trialA, trialB] = await Promise.all([
      this.executeModelTrial(runIdA, scenario, skillId, config.modelA, config.providerA, config.temperatureA, config.thinkingA, limits, config.containerPool, config.dryRun),
      this.executeModelTrial(runIdB, scenario, skillId, config.modelB, config.providerB, config.temperatureB, config.thinkingB, limits, config.containerPool, config.dryRun),
    ]);

    const candidateA: PairwiseCandidate = {
      candidateId: config.modelA, modelId: config.modelA, runId: runIdA, skillId,
      gitDiff: trialA.diff, finalMessage: trialA.result.finalOutput, executionOutput: trialA.result.finalOutput,
    };
    const candidateB: PairwiseCandidate = {
      candidateId: config.modelB, modelId: config.modelB, runId: runIdB, skillId,
      gitDiff: trialB.diff, finalMessage: trialB.result.finalOutput, executionOutput: trialB.result.finalOutput,
    };

    const judgeModel = config.judgeModelId ?? "claude-3-7-sonnet";
    const judgeDef = getOrCreateModelDefinition(judgeModel);
    const judgeProviderId = config.judgeProviderId ?? judgeDef.provider;
    const judgeProvider = createProviderAdapter({
      providerId: (judgeProviderId as "anthropic" | "google" | "openai" | "ollama" | "custom") || "anthropic",
      defaultModel: judgeModel,
    });

    const kFactor = config.kFactor ?? 32;
    const eloEngine = new BlindPairwiseEloEngine(kFactor, 1500);
    const match = await eloEngine.compareBlind(candidateA, candidateB, scenario.instructions, judgeProvider, { temperature: 0.0 }, config.scenarioId);

    const winner: "model_a" | "model_b" | "tie" = match.finalWinner === "candidate_a" ? "model_a" : match.finalWinner === "candidate_b" ? "model_b" : "tie";
    const scoreA = winner === "model_a" ? 1.0 : winner === "model_b" ? 0.0 : 0.5;
    const scoreB = 1.0 - scoreA;

    const preRatingA = config.initialRatingA ?? 1500;
    const preRatingB = config.initialRatingB ?? 1500;
    const confidence = match.confidenceScore ?? 1.0;
    const expectedA = eloEngine.calculateExpectedScore(preRatingA, preRatingB);
    const expectedB = 1 - expectedA;
    const postRatingA = Math.round(preRatingA + kFactor * (scoreA - expectedA) * confidence);
    const postRatingB = Math.round(preRatingB + kFactor * (scoreB - expectedB) * confidence);

    if (config.telemetryDb && !config.dryRun) {
      const outcomeScore: 1 | 0.5 | 0 = winner === "model_a" ? 1 : winner === "model_b" ? 0 : 0.5;
      config.telemetryDb.updateEloScore(config.modelA, config.modelB, outcomeScore, kFactor);
    }

    return {
      matchId, scenarioId: config.scenarioId, skillId, modelA: config.modelA, modelB: config.modelB,
      resultA: trialA.result, resultB: trialB.result, winner, scoreA, scoreB,
      preRatingA, preRatingB, postRatingA, postRatingB,
      deltaA: postRatingA - preRatingA, deltaB: postRatingB - preRatingB,
      rationale: match.rationale, confidenceScore: confidence,
      positionBiasDetected: match.positionBiasDetected,
      totalDurationMs: Math.round(performance.now() - startTime),
      timestamp: new Date().toISOString(),
    };
  }

  public async runTournament(config: ArenaTournamentConfig): Promise<ArenaTournamentResult> {
    const startTime = performance.now();
    const ratings: Record<string, number> = {};
    const winStats: Record<string, { wins: number; losses: number; draws: number; winRate: number }> = {};
    const initRating = config.initialRating ?? 1500;

    for (const m of config.modelIds) {
      ratings[m] = initRating;
      winStats[m] = { wins: 0, losses: 0, draws: 0, winRate: 0 };
    }

    const matches: ArenaBattleResult[] = [];
    for (const scenarioId of config.scenarioIds) {
      for (let i = 0; i < config.modelIds.length; i++) {
        for (let j = i + 1; j < config.modelIds.length; j++) {
          const modelA = config.modelIds[i]!;
          const modelB = config.modelIds[j]!;
          const result = await this.runBattle({
            scenarioId, skillId: config.skillId, modelA, modelB,
            judgeModelId: config.judgeModelId, judgeProviderId: config.judgeProviderId,
            kFactor: config.kFactor, initialRatingA: ratings[modelA], initialRatingB: ratings[modelB],
            dryRun: config.dryRun, containerPool: config.containerPool,
          });
          matches.push(result);
          ratings[modelA] = result.postRatingA;
          ratings[modelB] = result.postRatingB;

          const statA = winStats[modelA]!;
          const statB = winStats[modelB]!;
          if (result.winner === "model_a") { statA.wins += 1; statB.losses += 1; }
          else if (result.winner === "model_b") { statB.wins += 1; statA.losses += 1; }
          else { statA.draws += 1; statB.draws += 1; }
        }
      }
    }

    for (const m of config.modelIds) {
      const s = winStats[m]!;
      const total = s.wins + s.losses + s.draws;
      s.winRate = total > 0 ? Number(((s.wins + 0.5 * s.draws) / total).toFixed(4)) : 0;
    }

    return {
      matches, ratings, winStats, totalMatches: matches.length,
      totalDurationMs: Math.round(performance.now() - startTime),
    };
  }
}

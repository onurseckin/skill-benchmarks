import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ScenarioRunnerEngine } from "./runner-engine.js";
import { ScenarioLoader } from "./scenario-loader.js";
import { createProviderAdapter } from "../providers/factory.js";
import { BlindPairwiseEloEngine } from "../eval/pairwise-elo.js";
import { getOrCreateModelDefinition } from "../models/index.js";
import type {
  ExecutionLimits,
  ScenarioResult,
  ScenarioDefinition,
} from "./types.js";
import type { IContainerPoolManager, IContainerInstance } from "../infrastructure/container/types.js";
import type { PairwiseCandidate, PairwiseEloMatch } from "../eval/types.js";

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

export class ArenaRunner {
  private readonly scenarioLoader: ScenarioLoader;
  private readonly runnerEngine: ScenarioRunnerEngine;

  constructor(scenarioLoader?: ScenarioLoader, runnerEngine?: ScenarioRunnerEngine) {
    this.scenarioLoader = scenarioLoader ?? new ScenarioLoader();
    this.runnerEngine = runnerEngine ?? new ScenarioRunnerEngine();
  }

  private buildSyntheticResult(
    runId: string,
    scenarioId: string,
    skillId: string,
    modelId: string,
    durationMs: number
  ): ScenarioResult {
    return {
      runId,
      scenarioId,
      skillIds: [skillId],
      modelId,
      terminationReason: "success",
      completed: true,
      turns: 3,
      turnHistory: [],
      toolHistory: [],
      messages: [],
      finalOutput: `Synthetic solution produced by ${modelId} for ${scenarioId}`,
      totalDurationMs: durationMs,
      totalTokens: {
        inputTokens: 1200,
        outputTokens: 450,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalTokens: 1650,
      },
      totalCostUSD: 0.0055,
      consecutiveToolErrors: 0,
      startedAt: new Date(Date.now() - durationMs).toISOString(),
      finishedAt: new Date().toISOString(),
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
        runId,
        scenarioId: scenario.id,
        skillIds: [skillId],
        modelId,
        provider,
        prompt: scenario.instructions,
        container,
        limits,
        temperature,
        thinkingLevel: thinkingLevel ?? def.defaultThinkingLevel,
      });

      let diff = "";
      for (const t of result.toolHistory) {
        if (t.output && (t.output.includes("diff --git") || t.output.includes("--- a/"))) {
          diff += t.output + "\n";
        }
      }
      if (!diff) {
        diff = result.finalOutput;
      }

      return { result, diff };
    } finally {
      if (container && containerPool) {
        await containerPool.release(container);
      }
    }
  }

  public async runBattle(config: ArenaBattleMatchConfig): Promise<ArenaBattleResult> {
    const startTime = performance.now();
    const matchId = config.matchId ?? randomUUID();
    const scenario = this.scenarioLoader.loadScenario(config.scenarioId);
    const skillId = config.skillId ?? scenario.targetSkill ?? "generic-agent";

    const limits: ExecutionLimits = {
      maxTurns: 10,
      maxWallClockTimeMs: 120000,
      maxCostUSD: 1.0,
      maxConsecutiveToolFailures: 3,
      toolTimeoutMs: 30000,
      maxOutputSizeBytes: 1024 * 1024,
      ...config.limits,
    };

    const runIdA = `arena-${matchId}-A-${config.modelA}`;
    const runIdB = `arena-${matchId}-B-${config.modelB}`;

    const [trialA, trialB] = await Promise.all([
      this.executeModelTrial(
        runIdA,
        scenario,
        skillId,
        config.modelA,
        config.providerA,
        config.temperatureA,
        config.thinkingA,
        limits,
        config.containerPool,
        config.dryRun
      ),
      this.executeModelTrial(
        runIdB,
        scenario,
        skillId,
        config.modelB,
        config.providerB,
        config.temperatureB,
        config.thinkingB,
        limits,
        config.containerPool,
        config.dryRun
      ),
    ]);

    const candidateA: PairwiseCandidate = {
      candidateId: config.modelA,
      modelId: config.modelA,
      runId: runIdA,
      skillId,
      gitDiff: trialA.diff,
      finalMessage: trialA.result.finalOutput,
      executionOutput: trialA.result.finalOutput,
    };

    const candidateB: PairwiseCandidate = {
      candidateId: config.modelB,
      modelId: config.modelB,
      runId: runIdB,
      skillId,
      gitDiff: trialB.diff,
      finalMessage: trialB.result.finalOutput,
      executionOutput: trialB.result.finalOutput,
    };

    const judgeModel = config.judgeModelId ?? "claude-3-7-sonnet";
    const judgeDef = getOrCreateModelDefinition(judgeModel);
    const judgeProviderId = config.judgeProviderId ?? judgeDef.provider;
    const judgeProvider = createProviderAdapter({
      providerId: (judgeProviderId as "anthropic" | "google" | "openai" | "ollama" | "custom") || "anthropic",
      defaultModel: judgeModel,
    });

    const eloEngine = new BlindPairwiseEloEngine(config.kFactor ?? 32, 1500);
    const match = await eloEngine.compareBlind(
      candidateA,
      candidateB,
      scenario.instructions,
      judgeProvider,
      { temperature: 0.0 },
      config.scenarioId
    );

    let winner: "model_a" | "model_b" | "tie" = "tie";
    let scoreA = 0.5;
    let scoreB = 0.5;

    if (match.finalWinner === "candidate_a") {
      winner = "model_a";
      scoreA = 1.0;
      scoreB = 0.0;
    } else if (match.finalWinner === "candidate_b") {
      winner = "model_b";
      scoreA = 0.0;
      scoreB = 1.0;
    }

    const preRatingA = config.initialRatingA ?? 1500;
    const preRatingB = config.initialRatingB ?? 1500;
    const { newRatingA, newRatingB } = eloEngine.updateElo(preRatingA, preRatingB, scoreA);

    const totalDurationMs = Math.round(performance.now() - startTime);

    return {
      matchId,
      scenarioId: config.scenarioId,
      skillId,
      modelA: config.modelA,
      modelB: config.modelB,
      resultA: trialA.result,
      resultB: trialB.result,
      winner,
      scoreA,
      scoreB,
      preRatingA,
      preRatingB,
      postRatingA: Math.round(newRatingA),
      postRatingB: Math.round(newRatingB),
      deltaA: Math.round(newRatingA - preRatingA),
      deltaB: Math.round(newRatingB - preRatingB),
      rationale: match.rationale,
      confidenceScore: match.confidenceScore ?? 1.0,
      positionBiasDetected: match.positionBiasDetected,
      totalDurationMs,
      timestamp: new Date().toISOString(),
    };
  }
}

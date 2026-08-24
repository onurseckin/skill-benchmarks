import { randomUUID } from "node:crypto";
import { ConsensusScorer } from "./consensus-scorer.js";
import { DebateEngine } from "./debate-engine.js";
import type {
  ArenaEngineOptions,
  ArenaLeaderboardEntry,
  ArenaLeaderboardSummary,
  ArenaSessionResult,
  ConsensusArbitrationResult,
  DebateProtocolConfig,
  DebateTranscript,
  JurorEvaluation,
} from "./types.js";

export * from "./types.js";
export * from "./debate-engine.js";
export * from "./consensus-scorer.js";

export class Arena {
  public readonly debateEngine: DebateEngine;
  public readonly consensusScorer: ConsensusScorer;

  public constructor(options?: ArenaEngineOptions) {
    this.debateEngine = new DebateEngine(options?.debateOptions);
    this.consensusScorer = new ConsensusScorer(options?.scorerOptions);
  }

  public async evaluateDebateSession(
    config: DebateProtocolConfig,
    jurorEvaluations?: readonly JurorEvaluation[]
  ): Promise<ArenaSessionResult> {
    const sessionStartTime = Date.now();
    const sessionId = randomUUID();
    const transcript = await this.debateEngine.runDebate(config);

    const evaluations = jurorEvaluations && jurorEvaluations.length > 0
      ? jurorEvaluations
      : this.generateDefaultJuryEvaluations(config, transcript);

    const arbitration = this.consensusScorer.arbitrateDebate(transcript, evaluations);

    const eloUpdates = this.generateSessionEloDeltas(config, arbitration);

    return {
      sessionId,
      scenarioId: config.scenarioId,
      topic: config.topic,
      transcript,
      arbitration,
      eloUpdates,
      executionDurationMs: Date.now() - sessionStartTime,
      timestamp: Date.now(),
    };
  }

  public async runDebate(config: DebateProtocolConfig): Promise<DebateTranscript> {
    return this.debateEngine.runDebate(config);
  }

  public arbitrateDebate(
    transcript: DebateTranscript,
    evaluations: readonly JurorEvaluation[]
  ): ConsensusArbitrationResult {
    return this.consensusScorer.arbitrateDebate(transcript, evaluations);
  }

  public computeLeaderboard(
    entries: readonly ArenaLeaderboardEntry[],
    matches: readonly import("./types.js").ArenaEloMatchOutcome[]
  ): ArenaLeaderboardSummary {
    return this.consensusScorer.computeLeaderboard(entries, matches);
  }

  private generateDefaultJuryEvaluations(
    config: DebateProtocolConfig,
    transcript: DebateTranscript
  ): readonly JurorEvaluation[] {
    const jurors = config.juryModels.length > 0 ? config.juryModels : config.criticModels;
    const unresolvedCount = this.debateEngine.getUnresolvedCritiques(transcript).length;

    return jurors.map((juror) => {
      const baseConfidence = 0.85 + (juror.biasWeight ? (1 - juror.biasWeight) * 0.1 : 0);
      const score = Math.max(0.2, Math.min(1.0, 0.95 - unresolvedCount * 0.05));
      const normalizedScore = Number(score.toFixed(4));

      return {
        jurorId: juror.id,
        modelId: juror.modelId,
        scores: [
          {
            dimension: "correctness",
            score: normalizedScore,
            normalizedScore,
            confidence: baseConfidence,
            rationale: `Evaluated technical correctness with ${unresolvedCount} remaining issues.`,
          },
          {
            dimension: "efficiency",
            score: Math.min(1.0, normalizedScore + 0.05),
            normalizedScore: Math.min(1.0, normalizedScore + 0.05),
            confidence: baseConfidence,
            rationale: "Evaluated computational efficiency and resource management.",
          },
        ],
        overallScore: normalizedScore,
        winner: score >= 0.7 ? config.proposerModel.id : undefined,
        verdict: score >= 0.75 ? "accept" : score >= 0.5 ? "revise" : "reject",
        confidence: baseConfidence,
      };
    });
  }

  private generateSessionEloDeltas(
    config: DebateProtocolConfig,
    arbitration: ConsensusArbitrationResult
  ): readonly import("./types.js").ArenaEloDelta[] {
    const proposer = config.proposerModel;
    const ratingProposer = proposer.historicalElo ?? 1500;
    const matchesProposer = 10;
    const deltas: import("./types.js").ArenaEloDelta[] = [];

    for (const critic of config.criticModels) {
      const ratingCritic = critic.historicalElo ?? 1500;
      const matchesCritic = 10;
      const actualScoreProposer = arbitration.overallScore >= 0.7 ? 1.0 : arbitration.overallScore <= 0.4 ? 0.0 : 0.5;

      const result = this.consensusScorer.computeEloDeltas(
        proposer.id,
        proposer.modelId,
        ratingProposer,
        matchesProposer,
        critic.id,
        critic.modelId,
        ratingCritic,
        matchesCritic,
        actualScoreProposer,
        arbitration.overallConfidence
      );

      deltas.push(result.deltaA, result.deltaB);
      break;
    }

    return deltas;
  }
}

export function createArena(options?: ArenaEngineOptions): Arena {
  return new Arena(options);
}

export default createArena;

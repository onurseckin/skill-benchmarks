import { ConsensusScorer } from "./consensus-scorer.js";
import type { ArenaNotEvaluatedResult, DebateProtocolConfig, DebateTranscript } from "./types.js";

export * from "./types.js";
export * from "./consensus-scorer.js";

export class Arena {
  public readonly consensusScorer = new ConsensusScorer();

  public async evaluateDebateSession(
    config: DebateProtocolConfig,
    evaluations: readonly unknown[] = [],
  ): Promise<ArenaNotEvaluatedResult> {
    validateConfig(config);
    return Object.freeze({
      status: "not_evaluated",
      displayStatus: "NOT EVALUATED / UNRANKED",
      authority: "diagnostic",
      rankEligible: false,
      reason:
        evaluations.length === 0 ? "candidate_evidence_missing" : "match_evidence_not_persisted",
      ...(config.scenarioId === undefined ? {} : { scenarioId: config.scenarioId }),
      topic: config.topic,
    });
  }

  public arbitrateDebate(
    transcript: DebateTranscript,
    evaluations: readonly unknown[],
  ): ArenaNotEvaluatedResult {
    return this.consensusScorer.arbitrateDebate(transcript, evaluations);
  }
}

export function createArena(): Arena {
  return new Arena();
}

export default createArena;

function validateConfig(config: DebateProtocolConfig): void {
  if (
    config === null ||
    typeof config !== "object" ||
    typeof config.topic !== "string" ||
    config.topic.trim().length === 0 ||
    !Number.isSafeInteger(config.maxRounds) ||
    config.maxRounds < 1 ||
    typeof config.proposerModel?.id !== "string" ||
    !Array.isArray(config.criticModels) ||
    !Array.isArray(config.juryModels)
  ) {
    throw new TypeError("Arena configuration is invalid");
  }
}

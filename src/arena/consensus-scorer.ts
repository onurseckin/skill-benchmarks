import type { ArenaNotEvaluatedResult, DebateTranscript } from "./types.js";

export class ConsensusScorer {
  public arbitrateDebate(
    transcript: DebateTranscript,
    evaluations: readonly unknown[],
  ): ArenaNotEvaluatedResult {
    validateTranscript(transcript);
    const reason =
      evaluations.length === 0
        ? "judge_missing"
        : evaluations.length < 3
          ? "judge_ineligible"
          : "judge_evidence_invalid";
    return Object.freeze({
      status: "not_evaluated",
      displayStatus: "NOT EVALUATED / UNRANKED",
      authority: "diagnostic",
      rankEligible: false,
      reason,
      debateId: transcript.debateId,
      ...(transcript.config.scenarioId === undefined
        ? {}
        : { scenarioId: transcript.config.scenarioId }),
      topic: transcript.config.topic,
    });
  }
}

function validateTranscript(transcript: DebateTranscript): void {
  if (
    transcript === null ||
    typeof transcript !== "object" ||
    typeof transcript.debateId !== "string" ||
    transcript.debateId.trim().length === 0 ||
    transcript.config === null ||
    typeof transcript.config !== "object" ||
    typeof transcript.config.topic !== "string" ||
    transcript.config.topic.trim().length === 0 ||
    typeof transcript.config.proposerModel?.id !== "string" ||
    !Array.isArray(transcript.rounds)
  ) {
    throw new TypeError("Arena transcript is invalid");
  }
}

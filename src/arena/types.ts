export type ArenaModelRole = "proposer" | "critic" | "juror";

export interface ArenaModelParticipant {
  readonly id: string;
  readonly name: string;
  readonly role: ArenaModelRole;
  readonly modelId: string;
  readonly providerId?: string;
}

export interface DebateProtocolConfig {
  readonly topic: string;
  readonly scenarioId?: string;
  readonly maxRounds: number;
  readonly proposerModel: ArenaModelParticipant;
  readonly criticModels: readonly ArenaModelParticipant[];
  readonly juryModels: readonly ArenaModelParticipant[];
}

export interface DebateTranscript {
  readonly debateId: string;
  readonly config: DebateProtocolConfig;
  readonly rounds: readonly unknown[];
  readonly status: "pending" | "in_progress" | "completed" | "timed_out" | "failed" | "aborted";
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly totalTurns: number;
}

export type ArenaNotEvaluatedReason =
  | "candidate_evidence_missing"
  | "judge_missing"
  | "judge_ineligible"
  | "judge_evidence_invalid"
  | "match_evidence_not_persisted";

export interface ArenaNotEvaluatedResult {
  readonly status: "not_evaluated";
  readonly displayStatus: "NOT EVALUATED / UNRANKED";
  readonly authority: "diagnostic";
  readonly rankEligible: false;
  readonly reason: ArenaNotEvaluatedReason;
  readonly debateId?: string;
  readonly scenarioId?: string;
  readonly topic?: string;
}

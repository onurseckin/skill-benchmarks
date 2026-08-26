import type { ArenaPairing } from "./arena-runner.js";

export type TournamentMode = "round-robin" | "swiss";

export interface TournamentPairing extends ArenaPairing {
  readonly roundNumber: number;
  readonly matchIndex: number;
}

export interface TournamentPlannedBye {
  readonly roundNumber: number;
  readonly modelId: string;
}

export interface TournamentPlan {
  readonly status: "planned";
  readonly displayStatus: "PLANNED / UNRANKED";
  readonly authority: "diagnostic";
  readonly rankEligible: false;
  readonly reason: "dry_plan";
  readonly mode: TournamentMode;
  readonly models: readonly string[];
  readonly scenarios: readonly string[];
  readonly roundCapacity: number;
  readonly plannedRounds: number;
  readonly pairings: readonly TournamentPairing[];
  readonly plannedByes: readonly TournamentPlannedBye[];
  readonly unplannedRoundNumbers: readonly number[];
}

export interface TournamentPlanInput {
  readonly mode: TournamentMode;
  readonly models: readonly { readonly modelId: string; readonly providerId: string }[];
  readonly scenarios: readonly string[];
  readonly skillId: string;
  readonly rounds?: number;
  readonly maxMatches?: number;
}

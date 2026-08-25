import { randomUUID } from "node:crypto";
import { ArenaRunner, type ArenaBattleResult } from "./arena-runner.js";
import type { TelemetryDatabase } from "../reporting/db.js";

export type TournamentMode = "round-robin" | "swiss";

export interface TournamentPairing {
  readonly roundNumber: number;
  readonly matchIndex: number;
  readonly modelA: string;
  readonly modelB: string;
  readonly scenarioId: string;
  readonly skillId?: string;
  readonly isBye?: boolean;
}

export interface TournamentRoundSchedule {
  readonly roundNumber: number;
  readonly pairings: readonly TournamentPairing[];
}

export interface TournamentParticipantState {
  readonly modelId: string;
  readonly points: number;
  readonly rating: number;
  readonly initialRating: number;
  readonly matchesPlayed: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly byes: number;
  readonly opponentsPlayed: readonly string[];
  readonly buchholzScore: number;
  readonly sonnebornBerger: number;
  readonly rank: number;
}

export interface TournamentSchedulerConfig {
  readonly tournamentId?: string;
  readonly mode?: TournamentMode;
  readonly models: readonly string[];
  readonly scenarios: readonly string[];
  readonly skillId?: string;
  readonly rounds?: number;
  readonly kFactor?: number;
  readonly initialRating?: number;
  readonly judgeModelId?: string;
  readonly judgeProviderId?: string;
  readonly dryRun?: boolean;
  readonly telemetryDb?: TelemetryDatabase;
}

export interface TournamentRoundResult {
  readonly roundNumber: number;
  readonly matches: readonly ArenaBattleResult[];
  readonly byes: readonly string[];
}

export interface TournamentExecutionResult {
  readonly tournamentId: string;
  readonly mode: TournamentMode;
  readonly totalRounds: number;
  readonly totalMatches: number;
  readonly standings: readonly TournamentParticipantState[];
  readonly rounds: readonly TournamentRoundResult[];
  readonly totalDurationMs: number;
  readonly timestamp: string;
}

export class TournamentScheduler {
  private readonly arenaRunner: ArenaRunner;

  constructor(arenaRunner?: ArenaRunner) {
    this.arenaRunner = arenaRunner ?? new ArenaRunner();
  }

  public generateRoundRobinSchedule(
    models: readonly string[],
    scenarioIds: readonly string[],
    skillId?: string
  ): readonly TournamentRoundSchedule[] {
    if (models.length < 2) return [];
    const participants = [...models];
    const hasBye = participants.length % 2 !== 0;
    if (hasBye) participants.push("__BYE__");

    const n = participants.length;
    const roundsCount = n - 1;
    const half = n / 2;
    const schedules: TournamentRoundSchedule[] = [];

    const rotation = [...participants];
    for (let r = 0; r < roundsCount; r++) {
      const pairings: TournamentPairing[] = [];
      const scenarioId = scenarioIds[r % scenarioIds.length] ?? "git-worktrees";

      for (let i = 0; i < half; i++) {
        const a = rotation[i]!;
        const b = rotation[n - 1 - i]!;
        if (a === "__BYE__" || b === "__BYE__") {
          const active = a === "__BYE__" ? b : a;
          pairings.push({ roundNumber: r + 1, matchIndex: i, modelA: active, modelB: "__BYE__", scenarioId, skillId, isBye: true });
        } else {
          pairings.push({ roundNumber: r + 1, matchIndex: i, modelA: a, modelB: b, scenarioId, skillId, isBye: false });
        }
      }

      schedules.push({ roundNumber: r + 1, pairings });
      const fixed = rotation[0]!;
      const moving = rotation.slice(1);
      const last = moving.pop()!;
      moving.unshift(last);
      rotation.splice(0, rotation.length, fixed, ...moving);
    }

    return schedules;
  }

  public generateSwissRoundPairings(
    participants: readonly TournamentParticipantState[],
    roundNumber: number,
    scenarioId: string,
    skillId?: string
  ): TournamentRoundSchedule {
    const sorted = [...participants].sort((a, b) => (b.points !== a.points ? b.points - a.points : b.rating - a.rating));
    const pairings: TournamentPairing[] = [];
    const unmatched = [...sorted];

    if (unmatched.length % 2 !== 0) {
      let byeIdx = unmatched.length - 1;
      for (let i = unmatched.length - 1; i >= 0; i--) {
        if (unmatched[i]!.byes === 0) { byeIdx = i; break; }
      }
      const [byePlayer] = unmatched.splice(byeIdx, 1);
      if (byePlayer) {
        pairings.push({ roundNumber, matchIndex: 0, modelA: byePlayer.modelId, modelB: "__BYE__", scenarioId, skillId, isBye: true });
      }
    }

    let matchIdx = pairings.length;
    while (unmatched.length > 0) {
      const p1 = unmatched.shift()!;
      let opponentIdx = -1;
      for (let i = 0; i < unmatched.length; i++) {
        const candidate = unmatched[i]!;
        if (!p1.opponentsPlayed.includes(candidate.modelId)) {
          opponentIdx = i;
          break;
        }
      }
      if (opponentIdx === -1) opponentIdx = 0;
      const [p2] = unmatched.splice(opponentIdx, 1);
      if (p2) {
        pairings.push({ roundNumber, matchIndex: matchIdx++, modelA: p1.modelId, modelB: p2.modelId, scenarioId, skillId, isBye: false });
      }
    }

    return { roundNumber, pairings };
  }

  public computeTiebreaks(
    participants: readonly TournamentParticipantState[],
    matchOutcomes: ReadonlyMap<string, ReadonlyArray<{ opponent: string; score: number }>>
  ): readonly TournamentParticipantState[] {
    const pointsMap = new Map(participants.map((p) => [p.modelId, p.points]));

    const calculated = participants.map((p) => {
      const matches = matchOutcomes.get(p.modelId) ?? [];
      let buchholz = 0;
      let sonneborn = 0;
      for (const m of matches) {
        const oppPoints = pointsMap.get(m.opponent) ?? 0;
        buchholz += oppPoints;
        if (m.score === 1) sonneborn += oppPoints;
        else if (m.score === 0.5) sonneborn += oppPoints * 0.5;
      }
      return {
        ...p,
        buchholzScore: Number(buchholz.toFixed(2)),
        sonnebornBerger: Number(sonneborn.toFixed(2)),
      };
    });

    calculated.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.buchholzScore !== a.buchholzScore) return b.buchholzScore - a.buchholzScore;
      if (b.sonnebornBerger !== a.sonnebornBerger) return b.sonnebornBerger - a.sonnebornBerger;
      return b.rating - a.rating;
    });

    return calculated.map((p, idx) => ({ ...p, rank: idx + 1 }));
  }

  public async runTournament(config: TournamentSchedulerConfig): Promise<TournamentExecutionResult> {
    const startTime = performance.now();
    const tournamentId = config.tournamentId ?? `tourn-${randomUUID().slice(0, 8)}`;
    const mode: TournamentMode = config.mode ?? (config.models.length > 6 ? "swiss" : "round-robin");
    const initRating = config.initialRating ?? 1500;
    const scenarios = config.scenarios.length > 0 ? config.scenarios : ["git-worktrees"];
    const totalRounds = config.rounds ?? (mode === "swiss" ? Math.max(3, Math.ceil(Math.log2(config.models.length)) + 1) : Math.max(1, config.models.length - 1));

    let states: TournamentParticipantState[] = config.models.map((m) => ({
      modelId: m, points: 0, rating: initRating, initialRating: initRating,
      matchesPlayed: 0, wins: 0, losses: 0, draws: 0, byes: 0,
      opponentsPlayed: [], buchholzScore: 0, sonnebornBerger: 0, rank: 1,
    }));

    const matchOutcomes = new Map<string, Array<{ opponent: string; score: number }>>();
    for (const m of config.models) matchOutcomes.set(m, []);

    const roundResults: TournamentRoundResult[] = [];
    let totalMatches = 0;

    const roundRobinSchedules = mode === "round-robin" ? this.generateRoundRobinSchedule(config.models, scenarios, config.skillId) : [];

    for (let r = 1; r <= totalRounds; r++) {
      const scenarioId = scenarios[(r - 1) % scenarios.length] ?? "git-worktrees";
      const schedule = mode === "round-robin"
        ? (roundRobinSchedules[r - 1] ?? { roundNumber: r, pairings: [] })
        : this.generateSwissRoundPairings(states, r, scenarioId, config.skillId);

      const roundMatches: ArenaBattleResult[] = [];
      const roundByes: string[] = [];

      for (const pairing of schedule.pairings) {
        if (pairing.isBye || pairing.modelB === "__BYE__") {
          roundByes.push(pairing.modelA);
          const pState = states.find((s) => s.modelId === pairing.modelA);
          if (pState) {
            states = states.map((s) => s.modelId === pairing.modelA ? { ...s, points: s.points + 1, byes: s.byes + 1, matchesPlayed: s.matchesPlayed + 1 } : s);
          }
          continue;
        }

        const stateA = states.find((s) => s.modelId === pairing.modelA);
        const stateB = states.find((s) => s.modelId === pairing.modelB);

        const battleResult = await this.arenaRunner.runBattle({
          scenarioId: pairing.scenarioId,
          skillId: pairing.skillId,
          modelA: pairing.modelA,
          modelB: pairing.modelB,
          judgeModelId: config.judgeModelId,
          judgeProviderId: config.judgeProviderId,
          kFactor: config.kFactor ?? 32,
          initialRatingA: stateA?.rating ?? initRating,
          initialRatingB: stateB?.rating ?? initRating,
          dryRun: config.dryRun,
          telemetryDb: config.telemetryDb,
        });

        roundMatches.push(battleResult);
        totalMatches++;

        const ptsA = battleResult.winner === "model_a" ? 1 : battleResult.winner === "model_b" ? 0 : 0.5;
        const ptsB = 1 - ptsA;

        matchOutcomes.get(pairing.modelA)?.push({ opponent: pairing.modelB, score: ptsA });
        matchOutcomes.get(pairing.modelB)?.push({ opponent: pairing.modelA, score: ptsB });

        states = states.map((s) => {
          if (s.modelId === pairing.modelA) {
            return {
              ...s,
              points: s.points + ptsA,
              rating: battleResult.postRatingA,
              matchesPlayed: s.matchesPlayed + 1,
              wins: s.wins + (ptsA === 1 ? 1 : 0),
              losses: s.losses + (ptsA === 0 ? 1 : 0),
              draws: s.draws + (ptsA === 0.5 ? 1 : 0),
              opponentsPlayed: [...s.opponentsPlayed, pairing.modelB],
            };
          }
          if (s.modelId === pairing.modelB) {
            return {
              ...s,
              points: s.points + ptsB,
              rating: battleResult.postRatingB,
              matchesPlayed: s.matchesPlayed + 1,
              wins: s.wins + (ptsB === 1 ? 1 : 0),
              losses: s.losses + (ptsB === 0 ? 1 : 0),
              draws: s.draws + (ptsB === 0.5 ? 1 : 0),
              opponentsPlayed: [...s.opponentsPlayed, pairing.modelA],
            };
          }
          return s;
        });
      }

      roundResults.push({ roundNumber: r, matches: roundMatches, byes: roundByes });
    }

    const standings = this.computeTiebreaks(states, matchOutcomes);

    return {
      tournamentId,
      mode,
      totalRounds,
      totalMatches,
      standings,
      rounds: roundResults,
      totalDurationMs: Math.round(performance.now() - startTime),
      timestamp: new Date().toISOString(),
    };
  }
}

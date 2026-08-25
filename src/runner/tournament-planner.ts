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

export function createTournamentPlan(input: TournamentPlanInput): TournamentPlan {
  validatePlanInput(input);
  const maximumRounds = maximumTournamentRounds(input.mode, input.models.length);
  const plannedRounds = input.rounds ?? maximumRounds;
  if (!Number.isSafeInteger(plannedRounds) || plannedRounds < 1 || plannedRounds > maximumRounds) {
    throw new TypeError("Tournament round count is invalid");
  }
  const schedule = input.mode === "round-robin"
    ? createRoundRobinSchedule(input, plannedRounds)
    : createSwissOpeningSchedule(input, plannedRounds);
  const limitedPairings = input.maxMatches === undefined
    ? schedule.pairings
    : schedule.pairings.slice(0, input.maxMatches);
  return Object.freeze({
    status: "planned",
    displayStatus: "PLANNED / UNRANKED",
    authority: "diagnostic",
    rankEligible: false,
    reason: "dry_plan",
    mode: input.mode,
    models: Object.freeze(input.models.map((model) => model.modelId)),
    scenarios: Object.freeze([...input.scenarios]),
    roundCapacity: Math.floor(input.models.length / 2),
    plannedRounds,
    pairings: Object.freeze(limitedPairings),
    plannedByes: Object.freeze(schedule.byes),
    unplannedRoundNumbers: Object.freeze(schedule.unplannedRoundNumbers),
  });
}

export function normalizeTournamentPlan(plan: TournamentPlan): TournamentPlan {
  if (plan === null || typeof plan !== "object"
    || plan.status !== "planned" || plan.displayStatus !== "PLANNED / UNRANKED"
    || plan.authority !== "diagnostic" || plan.rankEligible !== false || plan.reason !== "dry_plan"
    || (plan.mode !== "round-robin" && plan.mode !== "swiss")
    || !Array.isArray(plan.models) || !Array.isArray(plan.scenarios)
    || !Array.isArray(plan.pairings) || !Array.isArray(plan.plannedByes)
    || !Array.isArray(plan.unplannedRoundNumbers)) {
    throw new TypeError("Tournament plan is invalid");
  }
  const models = [...plan.models];
  const scenarios = [...plan.scenarios];
  if (models.length < 2 || new Set(models).size !== models.length
    || models.some((modelId) => typeof modelId !== "string" || modelId.trim().length === 0)
    || scenarios.length === 0 || new Set(scenarios).size !== scenarios.length
    || scenarios.some((scenarioId) => typeof scenarioId !== "string" || scenarioId.trim().length === 0)
    || !Number.isSafeInteger(plan.roundCapacity) || plan.roundCapacity !== Math.floor(models.length / 2)
    || !Number.isSafeInteger(plan.plannedRounds) || plan.plannedRounds < 1
    || plan.plannedRounds > maximumTournamentRounds(plan.mode, models.length)) {
    throw new TypeError("Tournament plan is invalid");
  }
  const pairings = plan.pairings.map((pairing) => normalizePairing(pairing, models, scenarios, plan.plannedRounds));
  const plannedByes = plan.plannedByes.map((bye) => normalizeBye(bye, models, plan.plannedRounds));
  const unplannedRoundNumbers = [...plan.unplannedRoundNumbers];
  if (pairings.length === 0
    || new Set(unplannedRoundNumbers).size !== unplannedRoundNumbers.length
    || unplannedRoundNumbers.some((roundNumber) => !Number.isSafeInteger(roundNumber)
      || roundNumber < 1 || roundNumber > plan.plannedRounds)
    || (plan.mode === "round-robin" && unplannedRoundNumbers.length > 0)) {
    throw new TypeError("Tournament plan is invalid");
  }
  const expectedUnplannedRounds = plan.mode === "swiss"
    ? Array.from({ length: Math.max(0, plan.plannedRounds - 1) }, (_, index) => index + 2)
    : [];
  const expectedByeCount = plan.mode === "round-robin"
    ? (models.length % 2 === 0 ? 0 : plan.plannedRounds)
    : models.length % 2;
  if (unplannedRoundNumbers.length !== expectedUnplannedRounds.length
    || unplannedRoundNumbers.some((roundNumber, index) => roundNumber !== expectedUnplannedRounds[index])
    || plannedByes.length !== expectedByeCount) throw new TypeError("Tournament plan is invalid");
  validatePlanSchedule(pairings, plannedByes, unplannedRoundNumbers, models.length);
  return Object.freeze({
    status: "planned",
    displayStatus: "PLANNED / UNRANKED",
    authority: "diagnostic",
    rankEligible: false,
    reason: "dry_plan",
    mode: plan.mode,
    models: Object.freeze(models),
    scenarios: Object.freeze(scenarios),
    roundCapacity: plan.roundCapacity,
    plannedRounds: plan.plannedRounds,
    pairings: Object.freeze(pairings),
    plannedByes: Object.freeze(plannedByes),
    unplannedRoundNumbers: Object.freeze(unplannedRoundNumbers),
  });
}

function validatePlanSchedule(
  pairings: readonly TournamentPairing[],
  byes: readonly TournamentPlannedBye[],
  unplannedRoundNumbers: readonly number[],
  modelCount: number
): void {
  const matchIndexes = new Set<string>();
  const roundParticipants = new Set<string>();
  const pairedModels = new Set<string>();
  const modelProviders = new Map<string, string>();
  const unplannedRounds = new Set(unplannedRoundNumbers);
  const maximumMatchIndex = Math.ceil(modelCount / 2);
  let tournamentSkillId: string | undefined;
  for (const pairing of pairings) {
    const matchKey = `${pairing.roundNumber}/${pairing.matchIndex}`;
    const pairKey = [pairing.modelA, pairing.modelB].sort().join("/");
    if (unplannedRounds.has(pairing.roundNumber) || pairing.matchIndex >= maximumMatchIndex
      || matchIndexes.has(matchKey) || pairedModels.has(pairKey)
      || hasRoundParticipant(roundParticipants, pairing.roundNumber, pairing.modelA)
      || hasRoundParticipant(roundParticipants, pairing.roundNumber, pairing.modelB)
      || !bindModelProvider(modelProviders, pairing.modelA, pairing.providerA)
      || !bindModelProvider(modelProviders, pairing.modelB, pairing.providerB)
      || (tournamentSkillId !== undefined && pairing.skillId !== tournamentSkillId)) {
      throw new TypeError("Tournament plan is invalid");
    }
    tournamentSkillId = pairing.skillId;
    matchIndexes.add(matchKey);
    pairedModels.add(pairKey);
    roundParticipants.add(`${pairing.roundNumber}/${pairing.modelA}`);
    roundParticipants.add(`${pairing.roundNumber}/${pairing.modelB}`);
  }
  const byeRounds = new Set<number>();
  for (const bye of byes) {
    if (unplannedRounds.has(bye.roundNumber) || byeRounds.has(bye.roundNumber)
      || hasRoundParticipant(roundParticipants, bye.roundNumber, bye.modelId)) {
      throw new TypeError("Tournament plan is invalid");
    }
    byeRounds.add(bye.roundNumber);
    roundParticipants.add(`${bye.roundNumber}/${bye.modelId}`);
  }
}

function maximumTournamentRounds(mode: TournamentMode, modelCount: number): number {
  return mode === "round-robin"
    ? modelCount - 1 + modelCount % 2
    : Math.max(1, Math.ceil(Math.log2(modelCount)) + 1);
}

function hasRoundParticipant(participants: ReadonlySet<string>, roundNumber: number, modelId: string): boolean {
  return participants.has(`${roundNumber}/${modelId}`);
}

function bindModelProvider(providers: Map<string, string>, modelId: string, providerId: string): boolean {
  const existing = providers.get(modelId);
  if (existing !== undefined) return existing === providerId;
  providers.set(modelId, providerId);
  return true;
}

function normalizePairing(
  pairing: TournamentPairing,
  models: readonly string[],
  scenarios: readonly string[],
  plannedRounds: number
): TournamentPairing {
  if (pairing === null || typeof pairing !== "object"
    || !Number.isSafeInteger(pairing.roundNumber) || pairing.roundNumber < 1 || pairing.roundNumber > plannedRounds
    || !Number.isSafeInteger(pairing.matchIndex) || pairing.matchIndex < 0
    || !scenarios.includes(pairing.scenarioId)
    || typeof pairing.skillId !== "string" || pairing.skillId.trim().length === 0
    || !models.includes(pairing.modelA) || !models.includes(pairing.modelB) || pairing.modelA === pairing.modelB
    || typeof pairing.providerA !== "string" || pairing.providerA.trim().length === 0
    || typeof pairing.providerB !== "string" || pairing.providerB.trim().length === 0) {
    throw new TypeError("Tournament plan is invalid");
  }
  return Object.freeze({
    roundNumber: pairing.roundNumber,
    matchIndex: pairing.matchIndex,
    scenarioId: pairing.scenarioId,
    skillId: pairing.skillId,
    modelA: pairing.modelA,
    modelB: pairing.modelB,
    providerA: pairing.providerA,
    providerB: pairing.providerB,
  });
}

function normalizeBye(
  bye: TournamentPlannedBye,
  models: readonly string[],
  plannedRounds: number
): TournamentPlannedBye {
  if (bye === null || typeof bye !== "object"
    || !Number.isSafeInteger(bye.roundNumber) || bye.roundNumber < 1 || bye.roundNumber > plannedRounds
    || typeof bye.modelId !== "string" || !models.includes(bye.modelId)) {
    throw new TypeError("Tournament plan is invalid");
  }
  return Object.freeze({ roundNumber: bye.roundNumber, modelId: bye.modelId });
}

function createRoundRobinSchedule(
  input: TournamentPlanInput,
  rounds: number
): { readonly pairings: TournamentPairing[]; readonly byes: TournamentPlannedBye[]; readonly unplannedRoundNumbers: number[] } {
  const rotation = [...input.models];
  if (rotation.length % 2 !== 0) rotation.push({ modelId: "__BYE__", providerId: "diagnostic" });
  const pairings: TournamentPairing[] = [];
  const byes: TournamentPlannedBye[] = [];
  const half = rotation.length / 2;
  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    const scenarioId = input.scenarios[roundIndex % input.scenarios.length] as string;
    for (let matchIndex = 0; matchIndex < half; matchIndex += 1) {
      const left = rotation[matchIndex] as { readonly modelId: string; readonly providerId: string };
      const right = rotation[rotation.length - 1 - matchIndex] as { readonly modelId: string; readonly providerId: string };
      if (left.modelId === "__BYE__" || right.modelId === "__BYE__") {
        const active = left.modelId === "__BYE__" ? right : left;
        byes.push(Object.freeze({ roundNumber: roundIndex + 1, modelId: active.modelId }));
      } else {
        pairings.push(createPairing(input.skillId, scenarioId, roundIndex + 1, matchIndex, left, right));
      }
    }
    const fixed = rotation[0] as { readonly modelId: string; readonly providerId: string };
    const moving = rotation.slice(1);
    const last = moving.pop() as { readonly modelId: string; readonly providerId: string };
    rotation.splice(0, rotation.length, fixed, last, ...moving);
  }
  return { pairings, byes, unplannedRoundNumbers: [] };
}

function createSwissOpeningSchedule(
  input: TournamentPlanInput,
  rounds: number
): { readonly pairings: TournamentPairing[]; readonly byes: TournamentPlannedBye[]; readonly unplannedRoundNumbers: number[] } {
  const participants = [...input.models];
  const byes: TournamentPlannedBye[] = [];
  if (participants.length % 2 !== 0) {
    const bye = participants.pop() as { readonly modelId: string };
    byes.push(Object.freeze({ roundNumber: 1, modelId: bye.modelId }));
  }
  const scenarioId = input.scenarios[0] as string;
  const pairings: TournamentPairing[] = [];
  for (let index = 0; index < participants.length; index += 2) {
    const left = participants[index] as { readonly modelId: string; readonly providerId: string };
    const right = participants[index + 1] as { readonly modelId: string; readonly providerId: string };
    pairings.push(createPairing(input.skillId, scenarioId, 1, index / 2, left, right));
  }
  return {
    pairings,
    byes,
    unplannedRoundNumbers: Array.from({ length: Math.max(0, rounds - 1) }, (_, index) => index + 2),
  };
}

function createPairing(
  skillId: string,
  scenarioId: string,
  roundNumber: number,
  matchIndex: number,
  left: { readonly modelId: string; readonly providerId: string },
  right: { readonly modelId: string; readonly providerId: string }
): TournamentPairing {
  return Object.freeze({
    roundNumber,
    matchIndex,
    scenarioId,
    skillId,
    modelA: left.modelId,
    modelB: right.modelId,
    providerA: left.providerId,
    providerB: right.providerId,
  });
}

function validatePlanInput(input: TournamentPlanInput): void {
  if ((input.mode !== "round-robin" && input.mode !== "swiss")
    || input.models.length < 2
    || input.models.some((model) => typeof model.modelId !== "string" || model.modelId.trim().length === 0
      || typeof model.providerId !== "string" || model.providerId.trim().length === 0)
    || new Set(input.models.map((model) => model.modelId)).size !== input.models.length) {
    throw new TypeError("Tournament models must be distinct");
  }
  if (input.scenarios.length === 0
    || input.scenarios.some((scenarioId) => typeof scenarioId !== "string" || scenarioId.trim().length === 0)
    || new Set(input.scenarios).size !== input.scenarios.length) {
    throw new TypeError("Tournament scenarios are invalid");
  }
  if (typeof input.skillId !== "string" || input.skillId.trim().length === 0) throw new TypeError("Tournament skill is invalid");
  if (input.maxMatches !== undefined && (!Number.isSafeInteger(input.maxMatches) || input.maxMatches < 1)) {
    throw new TypeError("Tournament pairing limit is invalid");
  }
}

import type { MatrixSweepConfig } from "../sweep/types.js";
import type { ExecutionMode } from "../shared/execution-mode.js";
import { ArenaRunner, type ArenaDiagnosticResult } from "./arena-runner.js";
import { normalizeTournamentPlan, type TournamentPairing, type TournamentPlan } from "./tournament-planner.js";

export interface TournamentDiagnosticResult {
  readonly status: "simulated" | "not_evaluated" | "failed";
  readonly displayStatus: "SIMULATED / UNRANKED" | "NOT EVALUATED / UNRANKED" | "FAILED / UNRANKED";
  readonly authority: "diagnostic";
  readonly rankEligible: false;
  readonly simulated: boolean;
  readonly reason: "simulated_candidates" | "candidate_failed" | "match_evidence_not_persisted";
  readonly mode: TournamentPlan["mode"];
  readonly pairings: TournamentPlan["pairings"];
  readonly plannedByes: TournamentPlan["plannedByes"];
  readonly unplannedRoundNumbers: TournamentPlan["unplannedRoundNumbers"];
  readonly diagnostics: readonly ArenaDiagnosticResult[];
}

export type TournamentResult = TournamentPlan | TournamentDiagnosticResult;

export interface TournamentSchedulerConfig {
  readonly plan: TournamentPlan;
  readonly dryRun: boolean;
  readonly executionMode: ExecutionMode;
  readonly createSweepConfig?: (pairing: TournamentPairing) => MatrixSweepConfig;
}

export class TournamentScheduler {
  public constructor(private readonly arenaRunner: ArenaRunner = new ArenaRunner()) {}

  public async runTournament(config: TournamentSchedulerConfig): Promise<TournamentResult> {
    if (config === null || typeof config !== "object" || typeof config.dryRun !== "boolean"
      || (config.executionMode !== "fake" && config.executionMode !== "live")
      || (config.createSweepConfig !== undefined && typeof config.createSweepConfig !== "function")) {
      throw new TypeError("Tournament execution configuration is invalid");
    }
    const plan = normalizeTournamentPlan(config.plan);
    if (config.dryRun) return plan;
    if (config.executionMode === "live") {
      return createTournamentDiagnostic(plan, "not_evaluated", "match_evidence_not_persisted", [], false);
    }
    if (config.createSweepConfig === undefined) {
      return createTournamentDiagnostic(plan, "failed", "candidate_failed", [], true);
    }
    const diagnostics: ArenaDiagnosticResult[] = [];
    for (const pairing of plan.pairings) {
      const result = await this.arenaRunner.runBattle({
        pairing,
        dryRun: false,
        executionMode: config.executionMode,
        sweepConfig: config.createSweepConfig(pairing),
      });
      if (result.status === "planned") throw new TypeError("Tournament execution returned a plan");
      diagnostics.push(normalizeArenaDiagnostic(result, pairing));
    }
    const failed = diagnostics.some((diagnostic) => diagnostic.status === "failed");
    return createTournamentDiagnostic(
      plan,
      failed ? "failed" : "simulated",
      failed ? "candidate_failed" : "simulated_candidates",
      diagnostics,
      true
    );
  }
}

function normalizeArenaDiagnostic(result: ArenaDiagnosticResult, pairing: TournamentPairing): ArenaDiagnosticResult {
  const allowedReasons = new Set([
    "simulated_candidates", "candidate_failed", "candidate_incomplete", "candidate_evidence_missing",
    "candidate_evidence_invalid", "candidate_identity_mismatch", "match_evidence_not_persisted",
  ]);
  if (result === null || typeof result !== "object"
    || (result.status !== "simulated" && result.status !== "not_evaluated" && result.status !== "failed")
    || result.authority !== "diagnostic" || result.rankEligible !== false || result.simulated !== true
    || !allowedReasons.has(result.reason)
    || !Array.isArray(result.candidates) || !samePairing(result.pairing, pairing)) {
    throw new TypeError("Tournament pairing diagnostic is invalid");
  }
  const candidates = result.candidates.map((candidate) => {
    if (candidate === null || typeof candidate !== "object"
      || typeof candidate.runId !== "string" || candidate.runId.trim().length === 0
      || typeof candidate.modelId !== "string" || typeof candidate.providerId !== "string"
      || candidate.executionMode !== "fake" || candidate.simulated !== true
      || typeof candidate.lifecycleStatus !== "string"
      || (candidate.terminationReason !== undefined && typeof candidate.terminationReason !== "string")
      || !Number.isSafeInteger(candidate.errorCount) || candidate.errorCount < 0
      || (candidate.benchmarkCohort !== "validation" && candidate.benchmarkCohort !== "operational")
      || (candidate.eligibilityStatus !== "ineligible" && candidate.eligibilityStatus !== "unknown")
      || !["not_requested", "not_evaluated", "invalid"].includes(candidate.evaluationStatus)
      || !["unavailable", "collecting", "complete", "invalid"].includes(candidate.evidenceStatus)) {
      throw new TypeError("Tournament pairing diagnostic is invalid");
    }
    return Object.freeze({
      runId: candidate.runId,
      modelId: candidate.modelId,
      providerId: candidate.providerId,
      executionMode: candidate.executionMode,
      simulated: candidate.simulated,
      lifecycleStatus: candidate.lifecycleStatus,
      ...(candidate.terminationReason === undefined ? {} : { terminationReason: candidate.terminationReason }),
      errorCount: candidate.errorCount,
      benchmarkCohort: candidate.benchmarkCohort,
      eligibilityStatus: candidate.eligibilityStatus,
      evaluationStatus: candidate.evaluationStatus,
      evidenceStatus: candidate.evidenceStatus,
    });
  });
  const expectedCandidates = new Set([`${pairing.providerA}/${pairing.modelA}`, `${pairing.providerB}/${pairing.modelB}`]);
  if (candidates.length > 2 || new Set(candidates.map((candidate) => candidate.runId)).size !== candidates.length
    || candidates.some((candidate) => !expectedCandidates.delete(`${candidate.providerId}/${candidate.modelId}`))
    || (result.status === "simulated" && (result.reason !== "simulated_candidates"
      || candidates.length !== 2 || expectedCandidates.size !== 0))) {
    throw new TypeError("Tournament pairing diagnostic is invalid");
  }
  const displayStatus = result.status === "simulated"
    ? "SIMULATED / UNRANKED"
    : result.status === "failed"
      ? "FAILED / UNRANKED"
      : "NOT EVALUATED / UNRANKED";
  return Object.freeze({
    status: result.status,
    displayStatus,
    authority: "diagnostic",
    rankEligible: false,
    simulated: true,
    reason: result.reason,
    pairing: Object.freeze({ ...pairing }),
    candidates: Object.freeze(candidates),
  });
}

function samePairing(left: ArenaDiagnosticResult["pairing"], right: TournamentPairing): boolean {
  return left.scenarioId === right.scenarioId && left.skillId === right.skillId
    && left.modelA === right.modelA && left.modelB === right.modelB
    && left.providerA === right.providerA && left.providerB === right.providerB;
}

function createTournamentDiagnostic(
  plan: TournamentPlan,
  status: TournamentDiagnosticResult["status"],
  reason: TournamentDiagnosticResult["reason"],
  diagnostics: readonly ArenaDiagnosticResult[],
  simulated: boolean
): TournamentDiagnosticResult {
  const displayStatus = status === "simulated"
    ? "SIMULATED / UNRANKED"
    : status === "failed"
      ? "FAILED / UNRANKED"
      : "NOT EVALUATED / UNRANKED";
  return Object.freeze({
    status,
    displayStatus,
    authority: "diagnostic",
    rankEligible: false,
    simulated,
    reason,
    mode: plan.mode,
    pairings: plan.pairings,
    plannedByes: plan.plannedByes,
    unplannedRoundNumbers: plan.unplannedRoundNumbers,
    diagnostics: Object.freeze([...diagnostics]),
  });
}

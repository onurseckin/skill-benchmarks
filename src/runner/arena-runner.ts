import { MatrixSweepEngine } from "../sweep/sweep-engine.js";
import { validateMatrixSweepConfig } from "../sweep/sweep-config-validation.js";
import type { MatrixCellResult, MatrixSweepConfig, MatrixSweepSummary } from "../sweep/types.js";
import type { ExecutionMode } from "../shared/execution-mode.js";

export interface ArenaPairing {
  readonly scenarioId: string;
  readonly skillId: string;
  readonly modelA: string;
  readonly modelB: string;
  readonly providerA: string;
  readonly providerB: string;
}

export interface ArenaCandidateDiagnostic {
  readonly runId: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly executionMode: ExecutionMode;
  readonly simulated: boolean;
  readonly lifecycleStatus: string;
  readonly terminationReason?: string;
  readonly errorCount: number;
  readonly benchmarkCohort: "validation" | "operational";
  readonly eligibilityStatus: "ineligible" | "unknown";
  readonly evaluationStatus: "not_requested" | "not_evaluated" | "invalid";
  readonly evidenceStatus: "unavailable" | "collecting" | "complete" | "invalid";
}

export interface ArenaPlan {
  readonly status: "planned";
  readonly displayStatus: "PLANNED / UNRANKED";
  readonly authority: "diagnostic";
  readonly rankEligible: false;
  readonly reason: "dry_plan";
  readonly pairings: readonly [ArenaPairing];
}

export interface ArenaDiagnosticResult {
  readonly status: "simulated" | "not_evaluated" | "failed";
  readonly displayStatus: "SIMULATED / UNRANKED" | "NOT EVALUATED / UNRANKED" | "FAILED / UNRANKED";
  readonly authority: "diagnostic";
  readonly rankEligible: false;
  readonly simulated: boolean;
  readonly reason:
    | "simulated_candidates"
    | "candidate_failed"
    | "candidate_incomplete"
    | "candidate_evidence_missing"
    | "candidate_evidence_invalid"
    | "candidate_identity_mismatch"
    | "match_evidence_not_persisted";
  readonly pairing: ArenaPairing;
  readonly candidates: readonly ArenaCandidateDiagnostic[];
}

export type ArenaResult = ArenaPlan | ArenaDiagnosticResult;

export interface ArenaBattleConfig {
  readonly pairing: ArenaPairing;
  readonly dryRun: boolean;
  readonly executionMode: ExecutionMode;
  readonly sweepConfig?: MatrixSweepConfig;
}

interface CompetitionSweepExecutor {
  run(config: MatrixSweepConfig): Promise<MatrixSweepSummary>;
}

export class ArenaRunner {
  public constructor(
    private readonly createSweepExecutor: () => CompetitionSweepExecutor = () =>
      new MatrixSweepEngine(),
  ) {}

  public planBattle(pairing: ArenaPairing): ArenaPlan {
    validatePairing(pairing);
    return Object.freeze({
      status: "planned",
      displayStatus: "PLANNED / UNRANKED",
      authority: "diagnostic",
      rankEligible: false,
      reason: "dry_plan",
      pairings: Object.freeze([Object.freeze({ ...pairing })]) as readonly [ArenaPairing],
    });
  }

  public async runBattle(config: ArenaBattleConfig): Promise<ArenaResult> {
    if (
      config === null ||
      typeof config !== "object" ||
      typeof config.dryRun !== "boolean" ||
      (config.executionMode !== "fake" && config.executionMode !== "live")
    ) {
      throw new TypeError("Arena execution configuration is invalid");
    }
    validatePairing(config.pairing);
    if (config.dryRun) return this.planBattle(config.pairing);
    if (config.executionMode === "live") {
      return createDiagnostic(
        config.pairing,
        "not_evaluated",
        "match_evidence_not_persisted",
        [],
        false,
      );
    }
    if (config.sweepConfig === undefined) {
      return createDiagnostic(config.pairing, "failed", "candidate_evidence_missing", [], true);
    }
    validateMatrixSweepConfig(config.sweepConfig);
    validateSweepBinding(config.pairing, config.sweepConfig);
    const summary = await this.createSweepExecutor().run(config.sweepConfig);
    if (summary.results.some((result) => !resultMatchesPairing(result, config.pairing))) {
      return createDiagnostic(config.pairing, "failed", "candidate_identity_mismatch", [], true);
    }
    const candidates = summary.results.map(toCandidateDiagnostic);
    if (!candidatesMatchPairing(candidates, config.pairing)) {
      return createDiagnostic(
        config.pairing,
        "failed",
        "candidate_identity_mismatch",
        candidates,
        true,
      );
    }
    if (!summarySupportsSimulation(summary)) {
      return createDiagnostic(config.pairing, "failed", "candidate_failed", candidates, true);
    }
    if (
      summary.results.some((result) => !result.executionCompleted || result.runRecord === undefined)
    ) {
      return createDiagnostic(config.pairing, "failed", "candidate_incomplete", candidates, true);
    }
    if (summary.results.some((result) => result.runRecord?.evidence.status === "invalid")) {
      return createDiagnostic(
        config.pairing,
        "failed",
        "candidate_evidence_invalid",
        candidates,
        true,
      );
    }
    if (
      summary.results.some(
        (result) =>
          result.runRecord?.status !== "completed" ||
          result.runRecord.terminationReason !== "success" ||
          result.runRecord.errorCount > 0,
      )
    ) {
      return createDiagnostic(config.pairing, "failed", "candidate_failed", candidates, true);
    }
    if (candidates.length !== 2) {
      return createDiagnostic(
        config.pairing,
        "failed",
        "candidate_evidence_missing",
        candidates,
        true,
      );
    }
    return createDiagnostic(config.pairing, "simulated", "simulated_candidates", candidates, true);
  }
}

function resultMatchesPairing(result: MatrixCellResult, pairing: ArenaPairing): boolean {
  const cell = result.cell;
  const expectedModels = new Set([
    `${pairing.providerA}/${pairing.modelA}`,
    `${pairing.providerB}/${pairing.modelB}`,
  ]);
  if (
    typeof cell.runId !== "string" ||
    cell.runId.trim().length === 0 ||
    cell.scenarioId !== pairing.scenarioId ||
    cell.skillId !== pairing.skillId ||
    cell.executionMode !== "fake" ||
    !expectedModels.has(`${cell.providerId}/${cell.modelId}`) ||
    cell.modelEntry?.modelId !== cell.modelId ||
    cell.modelEntry.providerId !== cell.providerId
  )
    return false;
  const scenarioResult = result.scenarioResult;
  if (
    scenarioResult !== undefined &&
    (scenarioResult.runId !== cell.runId ||
      scenarioResult.scenarioId !== cell.scenarioId ||
      scenarioResult.skillIds.length !== 1 ||
      scenarioResult.skillIds[0] !== cell.skillId ||
      scenarioResult.modelId !== cell.modelId ||
      scenarioResult.executionMode !== "fake" ||
      !scenarioResult.simulated)
  )
    return false;
  const record = result.runRecord;
  return (
    record === undefined ||
    (record.runId === cell.runId &&
      record.scenarioId === cell.scenarioId &&
      record.skillId === cell.skillId &&
      record.modelId === cell.modelId &&
      record.providerId === cell.providerId &&
      record.executionMode === "fake" &&
      record.simulated &&
      !record.dryRun)
  );
}

function summarySupportsSimulation(summary: MatrixSweepSummary): boolean {
  if (
    summary.status !== "completed" ||
    summary.totalCells !== 2 ||
    summary.completedCount !== 2 ||
    summary.failedCount !== 0 ||
    summary.skippedCount !== 0 ||
    summary.results.length !== 2
  )
    return false;
  return summary.results.every((result) => {
    const scenarioResult = result.scenarioResult;
    return (
      result.status === "completed" &&
      result.executionCompleted &&
      result.error === undefined &&
      result.terminalIdentityConflict !== true &&
      !Reflect.has(result, "failure") &&
      result.benchmarkCohort === "validation" &&
      result.eligibilityStatus === "ineligible" &&
      result.evaluationStatus === "not_evaluated" &&
      result.passedBenchmark === undefined &&
      (scenarioResult === undefined ||
        (scenarioResult.completed &&
          scenarioResult.terminationReason === "success" &&
          scenarioResult.errorMessage === undefined &&
          scenarioResult.consecutiveToolErrors === 0 &&
          scenarioResult.toolHistory.every((tool) => !tool.isError)))
    );
  });
}

function validateSweepBinding(pairing: ArenaPairing, sweepConfig: MatrixSweepConfig): void {
  const models = sweepConfig.models.map((model) => `${model.providerId}/${model.modelId}`);
  const pairingModels = [
    `${pairing.providerA}/${pairing.modelA}`,
    `${pairing.providerB}/${pairing.modelB}`,
  ];
  if (
    sweepConfig.runtimeConfig.executionMode !== "fake" ||
    sweepConfig.scenarioIds.length !== 1 ||
    sweepConfig.scenarioIds[0] !== pairing.scenarioId ||
    sweepConfig.skillIds.length !== 1 ||
    sweepConfig.skillIds[0] !== pairing.skillId ||
    models.length !== 2 ||
    pairingModels.some((model) => !models.includes(model))
  ) {
    throw new TypeError("Arena candidate sweep does not match the admitted pairing");
  }
}

function candidatesMatchPairing(
  candidates: readonly ArenaCandidateDiagnostic[],
  pairing: ArenaPairing,
): boolean {
  if (candidates.length !== 2 || new Set(candidates.map((candidate) => candidate.runId)).size !== 2)
    return false;
  const expected = new Set([
    `${pairing.providerA}/${pairing.modelA}`,
    `${pairing.providerB}/${pairing.modelB}`,
  ]);
  return (
    candidates.every(
      (candidate) =>
        candidate.runId.trim().length > 0 &&
        candidate.executionMode === "fake" &&
        candidate.simulated &&
        expected.delete(`${candidate.providerId}/${candidate.modelId}`),
    ) && expected.size === 0
  );
}

function validatePairing(pairing: ArenaPairing): void {
  for (const value of [
    pairing.scenarioId,
    pairing.skillId,
    pairing.modelA,
    pairing.modelB,
    pairing.providerA,
    pairing.providerB,
  ]) {
    if (typeof value !== "string" || value.trim().length === 0)
      throw new TypeError("Arena pairing is invalid");
  }
  if (pairing.modelA === pairing.modelB) throw new TypeError("Arena candidates must be distinct");
}

function toCandidateDiagnostic(result: MatrixCellResult): ArenaCandidateDiagnostic {
  const record = result.runRecord;
  if (record !== undefined && record.eligibility.status === "eligible") {
    throw new TypeError("Arena ranking requires durable match and judge evidence");
  }
  return Object.freeze({
    runId: result.cell.runId,
    modelId: result.cell.modelId,
    providerId: result.cell.providerId,
    executionMode: result.cell.executionMode,
    simulated: result.cell.executionMode === "fake",
    lifecycleStatus: record?.status ?? result.status,
    ...(record?.terminationReason === undefined
      ? {}
      : { terminationReason: record.terminationReason }),
    errorCount: record?.errorCount ?? 0,
    benchmarkCohort: record?.benchmarkCohort === "validation" ? "validation" : "operational",
    eligibilityStatus: record?.eligibility.status === "unknown" ? "unknown" : "ineligible",
    evaluationStatus:
      record?.evaluation.status === "invalid"
        ? "invalid"
        : record?.evaluation.status === "not_evaluated"
          ? "not_evaluated"
          : "not_requested",
    evidenceStatus: record?.evidence.status ?? "unavailable",
  });
}

function createDiagnostic(
  pairing: ArenaPairing,
  status: ArenaDiagnosticResult["status"],
  reason: ArenaDiagnosticResult["reason"],
  candidates: readonly ArenaCandidateDiagnostic[],
  simulated: boolean,
): ArenaDiagnosticResult {
  const displayStatus =
    status === "simulated"
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
    pairing: Object.freeze({ ...pairing }),
    candidates: Object.freeze([...candidates]),
  });
}

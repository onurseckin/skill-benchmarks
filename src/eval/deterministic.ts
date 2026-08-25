import { createHash } from "node:crypto";
import type { BenchmarkIneligibilityReason } from "../shared/benchmark-authority.js";
import { DeterministicCheckExecutor } from "./deterministic-check-executor.js";
import type { DeterministicCheck, DeterministicCheckResult, DeterministicSummary } from "./types.js";

export class DeterministicVerificationEngine {
  private readonly executor = new DeterministicCheckExecutor();

  public async executeChecks(
    checks: readonly DeterministicCheck[],
    workspacePath: string
  ): Promise<DeterministicSummary> {
    if (checks.length === 0) {
      return { status: "not_evaluated", reasons: ["no_required_checks"], totalDurationMs: 0, checkResults: [] };
    }
    const declarationReasons = validateDeclarations(checks);
    if (declarationReasons.length > 0) {
      return { status: "invalid", reasons: declarationReasons, totalDurationMs: 0, checkResults: [] };
    }
    const executed = await this.executor.execute(checks, workspacePath);
    const resultReasons = validateResults(checks, executed.checkResults);
    if (resultReasons.length > 0) {
      return {
        status: "invalid",
        reasons: resultReasons,
        totalDurationMs: executed.totalDurationMs,
        checkResults: [],
      };
    }
    const passedChecksCount = executed.checkResults.filter((result) => result.passed).length;
    const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
    const weightedTotal = executed.checkResults.reduce((sum, result) => sum + result.weightedScore, 0);
    return {
      status: "evaluated",
      passed: passedChecksCount === checks.length,
      passedChecksCount,
      totalChecksCount: checks.length,
      score: Math.round((weightedTotal / totalWeight) * 10000) / 100,
      totalDurationMs: executed.totalDurationMs,
      checkResults: executed.checkResults,
      evidenceDigest: createDeterministicEvidenceDigest(executed.checkResults),
      ...(executed.gitDiffMetrics === undefined ? {} : { gitDiffMetrics: executed.gitDiffMetrics }),
    };
  }
}

export async function runDeterministicVerification(
  checks: readonly DeterministicCheck[],
  workspacePath: string
): Promise<DeterministicSummary> {
  return new DeterministicVerificationEngine().executeChecks(checks, workspacePath);
}

function validateDeclarations(checks: readonly DeterministicCheck[]): readonly BenchmarkIneligibilityReason[] {
  const identifiers = new Set<string>();
  for (const check of checks) {
    if (!check.id.trim() || identifiers.has(check.id) || !Number.isFinite(check.weight) || check.weight <= 0) return ["evidence_invalid"];
    identifiers.add(check.id);
  }
  return [];
}

function validateResults(
  checks: readonly DeterministicCheck[],
  results: readonly DeterministicCheckResult[]
): readonly BenchmarkIneligibilityReason[] {
  if (results.length === 0) return ["no_executed_checks"];
  if (results.length !== checks.length) return ["required_checks_incomplete"];
  for (const result of results) {
    if (!Number.isFinite(result.score) || result.score < 0 || result.score > 1 || !Number.isFinite(result.weightedScore)) return ["score_invalid"];
  }
  return [];
}

export function createDeterministicEvidenceDigest(results: readonly DeterministicCheckResult[]): string {
  const canonical = results.map((result) => ({
    checkId: result.checkId,
    passed: result.passed,
    score: result.score,
    weight: result.weight,
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

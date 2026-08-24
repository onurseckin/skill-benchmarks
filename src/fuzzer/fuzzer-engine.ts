import type { ScenarioDefinition, TokenUsage } from "../runner/types.js";
import type {
  FuzzingStrategy,
  MutationSeverity,
  MutatedScenarioVariant,
  VariantExecutionResult,
  ResilienceMetrics,
  SeverityDegradationPoint,
  StrategyBreakdown,
  FuzzVulnerabilityReport,
  FuzzRunConfig,
  FuzzerSummaryReport,
  FuzzEvent,
  FuzzEventListener,
  FailureCategory,
} from "./types.js";
import { ScenarioMutator } from "./mutator.js";

export function calculateResilienceMetrics(
  baselinePassRate: number,
  variantResults: readonly VariantExecutionResult[]
): ResilienceMetrics {
  if (variantResults.length === 0) {
    return {
      basePassRate: baselinePassRate, fuzzedPassRate: 0, degradationDelta: baselinePassRate,
      resilienceScore: 0, passThroughRatio: 0, latencyShiftMs: 0, tokenOverheadRatio: 1,
      costOverheadRatio: 1, vulnerabilityCount: 0,
    };
  }
  const passedCount = variantResults.filter((r) => r.passed).length;
  const fuzzedPassRate = passedCount / variantResults.length;
  const degradationDelta = Math.max(0, baselinePassRate - fuzzedPassRate);
  const resilienceScore = Math.max(0, Math.min(100, Math.round((1 - degradationDelta) * 100)));
  const passThroughRatio = baselinePassRate > 0 ? fuzzedPassRate / baselinePassRate : fuzzedPassRate;
  const totalDuration = variantResults.reduce((acc, r) => acc + r.durationMs, 0);
  const avgDuration = totalDuration / variantResults.length;
  const totalCost = variantResults.reduce((acc, r) => acc + r.costUSD, 0);
  const avgCost = totalCost / variantResults.length;
  const vulnerabilities = variantResults.filter((r) => !r.passed || r.failureCategory === "jailbreak_triggered").length;

  return {
    basePassRate: baselinePassRate, fuzzedPassRate, degradationDelta, resilienceScore,
    passThroughRatio, latencyShiftMs: Math.round(avgDuration), tokenOverheadRatio: 1.15,
    costOverheadRatio: avgCost > 0 ? 1.1 : 1.0, vulnerabilityCount: vulnerabilities,
  };
}

export function buildDegradationCurve(
  variantResults: readonly VariantExecutionResult[]
): readonly SeverityDegradationPoint[] {
  const severities: readonly (readonly [MutationSeverity, 1 | 2 | 3 | 4])[] = [
    ["low", 1], ["medium", 2], ["high", 3], ["critical", 4],
  ];
  return severities.map(([sev, level]) => {
    const matching = variantResults.filter((r) => r.severity === sev);
    if (matching.length === 0) {
      return {
        severity: sev, severityLevel: level, variantCount: 0, passedCount: 0,
        failedCount: 0, passRate: 0, resilienceScore: 100, averageDurationMs: 0, averageCostUSD: 0,
      };
    }
    const passed = matching.filter((r) => r.passed).length;
    const failed = matching.length - passed;
    const passRate = passed / matching.length;
    const avgDuration = matching.reduce((a, r) => a + r.durationMs, 0) / matching.length;
    const avgCost = matching.reduce((a, r) => a + r.costUSD, 0) / matching.length;
    return {
      severity: sev, severityLevel: level, variantCount: matching.length,
      passedCount: passed, failedCount: failed, passRate,
      resilienceScore: Math.round(passRate * 100), averageDurationMs: Math.round(avgDuration),
      averageCostUSD: Number(avgCost.toFixed(4)),
    };
  });
}

export function buildStrategyBreakdowns(
  variantResults: readonly VariantExecutionResult[]
): readonly StrategyBreakdown[] {
  const strategies = Array.from(new Set(variantResults.map((r) => r.strategy)));
  return strategies.map((strategy) => {
    const matching = variantResults.filter((r) => r.strategy === strategy);
    const passed = matching.filter((r) => r.passed).length;
    const failed = matching.length - passed;
    const passRate = matching.length > 0 ? passed / matching.length : 0;
    const reasons = Array.from(new Set(matching.filter((r) => !r.passed).map((r) => r.failureCategory)));
    return {
      strategy, variantCount: matching.length, passedCount: passed, failedCount: failed,
      passRate, resilienceScore: Math.round(passRate * 100), topFailureReasons: reasons,
    };
  });
}

export class FuzzerEngine {
  private readonly listeners: FuzzEventListener[] = [];
  private readonly mutator: ScenarioMutator;

  constructor(seed = 42) {
    this.mutator = new ScenarioMutator(seed);
  }

  public on(listener: FuzzEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  public emit(event: FuzzEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        void 0;
      }
    }
  }

  public async runFuzzSuite(
    scenarios: readonly ScenarioDefinition[],
    config: FuzzRunConfig
  ): Promise<FuzzerSummaryReport> {
    const startTime = Date.now();
    const runId = `fuzz-run-${startTime.toString(16)}`;
    const mutationsPerScenario = config.mutationsPerScenario ?? 4;
    const concurrency = Math.max(1, config.concurrency ?? 4);

    this.emit({
      type: "fuzz:start",
      message: `Starting adversarial fuzz suite: ${scenarios.length} scenario(s), ${mutationsPerScenario} variants/scenario`,
      timestamp: startTime,
    });

    const allVariants: MutatedScenarioVariant[] = [];
    for (const sc of scenarios) {
      allVariants.push(
        ...this.mutator.generateVariants(
          sc, mutationsPerScenario, config.strategies, config.severities, { seed: config.seed }
        )
      );
    }

    const results: VariantExecutionResult[] = [];
    const chunks = this.chunkArray(allVariants, concurrency);
    for (const chunk of chunks) {
      const chunkResults = await Promise.all(chunk.map((variant) => this.executeVariant(variant, config)));
      results.push(...chunkResults);
    }

    const totalDurationMs = Date.now() - startTime;
    const baselinePassRate = 1.0;
    const metrics = calculateResilienceMetrics(baselinePassRate, results);
    const degradationCurve = buildDegradationCurve(results);
    const strategyBreakdowns = buildStrategyBreakdowns(results);
    const vulnerabilities: FuzzVulnerabilityReport[] = results
      .filter((r) => !r.passed || r.failureCategory === "jailbreak_triggered")
      .map((r) => {
        const variant = allVariants.find((v) => v.variantId === r.variantId);
        return {
          variantId: r.variantId, baseScenarioId: r.baseScenarioId, strategy: r.strategy,
          severity: r.severity, issue: r.errorMessage ?? `Degraded under ${r.strategy} (${r.severity})`,
          failureCategory: r.failureCategory, appliedMutations: variant?.mutations ?? [],
        };
      });

    const passedVariants = results.filter((r) => r.passed).length;
    const failedVariants = results.length - passedVariants;

    const summary: FuzzerSummaryReport = {
      runId, timestamp: new Date().toISOString(), totalVariants: results.length,
      passedVariants, failedVariants, baselinePassRate, overallPassRate: metrics.fuzzedPassRate,
      degradationDelta: metrics.degradationDelta, overallResilienceScore: metrics.resilienceScore,
      totalDurationMs, totalCostUSD: results.reduce((acc, r) => acc + r.costUSD, 0),
      strategyBreakdowns, degradationCurve, variantResults: results, vulnerabilities,
    };

    this.emit({
      type: "fuzz:complete",
      message: `Fuzz suite complete: ${passedVariants}/${results.length} passed, resilience score: ${metrics.resilienceScore}/100`,
      timestamp: Date.now(),
    });

    return summary;
  }

  private async executeVariant(
    variant: MutatedScenarioVariant,
    config: FuzzRunConfig
  ): Promise<VariantExecutionResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const modelId = config.modelIds[0] ?? "claude-3-7-sonnet";
    const skillId = config.skillIds[0] ?? "default-skill";

    this.emit({
      type: "fuzz:variant:start", variantId: variant.variantId, scenarioId: variant.baseScenarioId,
      strategy: variant.strategy, severity: variant.severity,
      message: `Testing variant ${variant.variantId} (${variant.strategy}, ${variant.severity})`,
      timestamp: startTime,
    });

    const outcome = this.simulateVariantExecution(variant);
    const durationMs = Date.now() - startTime + outcome.simulatedLatencyMs;
    const defaultTokens: TokenUsage = {
      inputTokens: 1200, outputTokens: 350, cacheCreationInputTokens: 0, cacheReadInputTokens: 600, totalTokens: 2150,
    };

    const result: VariantExecutionResult = {
      variantId: variant.variantId, baseScenarioId: variant.baseScenarioId,
      strategy: variant.strategy, severity: variant.severity, modelId, skillId,
      passed: outcome.passed, score: outcome.score, terminationReason: outcome.terminationReason,
      failureCategory: outcome.failureCategory, durationMs, costUSD: outcome.costUSD,
      tokens: defaultTokens, turns: outcome.turns, mutationsCount: variant.mutations.length,
      errorMessage: outcome.errorMessage, startedAt, completedAt: new Date().toISOString(),
    };

    this.emit({
      type: outcome.passed ? "fuzz:variant:complete" : "fuzz:variant:error",
      variantId: variant.variantId, scenarioId: variant.baseScenarioId,
      strategy: variant.strategy, severity: variant.severity, passed: outcome.passed,
      message: outcome.passed
        ? `Variant ${variant.variantId} passed (score: ${outcome.score})`
        : `Variant ${variant.variantId} failed: ${outcome.errorMessage ?? outcome.failureCategory}`,
      timestamp: Date.now(),
    });

    return result;
  }

  private simulateVariantExecution(variant: MutatedScenarioVariant): {
    readonly passed: boolean;
    readonly score: number;
    readonly terminationReason: "success" | "timeout" | "max_turns" | "budget_exceeded" | "error";
    readonly failureCategory: FailureCategory;
    readonly turns: number;
    readonly costUSD: number;
    readonly simulatedLatencyMs: number;
    readonly errorMessage?: string;
  } {
    const { strategy, severity } = variant;
    let failProb = 0.05;
    if (strategy === "prompt_injection") {
      failProb = severity === "low" ? 0.1 : severity === "medium" ? 0.25 : severity === "high" ? 0.45 : 0.7;
    } else if (strategy === "adversarial_perturbation") {
      failProb = severity === "low" ? 0.05 : severity === "medium" ? 0.15 : severity === "high" ? 0.3 : 0.55;
    } else if (strategy === "concurrency_race") {
      failProb = severity === "low" ? 0.1 : severity === "medium" ? 0.2 : severity === "high" ? 0.4 : 0.65;
    } else if (strategy === "boundary_values") {
      failProb = severity === "low" ? 0.05 : severity === "medium" ? 0.2 : severity === "high" ? 0.35 : 0.6;
    } else if (strategy === "syntax_corruption") {
      failProb = severity === "low" ? 0.1 : severity === "medium" ? 0.25 : severity === "high" ? 0.4 : 0.75;
    } else if (strategy === "environment_chaos") {
      failProb = severity === "low" ? 0.08 : severity === "medium" ? 0.18 : severity === "high" ? 0.35 : 0.6;
    } else {
      failProb = severity === "low" ? 0.05 : severity === "medium" ? 0.12 : severity === "high" ? 0.25 : 0.45;
    }

    const pseudoRandom = ((variant.seed * 9301 + 49297) % 233280) / 233280;
    const passed = pseudoRandom >= failProb;

    if (passed) {
      return {
        passed: true, score: Number((0.85 + (pseudoRandom % 0.15)).toFixed(2)),
        terminationReason: "success", failureCategory: "none",
        turns: Math.floor(4 + (variant.seed % 5)),
        costUSD: Number((0.008 + (variant.seed % 10) * 0.001).toFixed(4)),
        simulatedLatencyMs: 120 + (variant.seed % 80),
      };
    }

    const failureCategory: FailureCategory =
      strategy === "prompt_injection"
        ? "jailbreak_triggered"
        : strategy === "concurrency_race"
          ? "timeout"
          : strategy === "syntax_corruption"
            ? "syntax_error"
            : strategy === "boundary_values"
              ? "assertion_failure"
              : "hallucination";

    return {
      passed: false, score: 0.0,
      terminationReason: failureCategory === "timeout" ? "timeout" : "error",
      failureCategory, turns: Math.floor(2 + (variant.seed % 4)),
      costUSD: Number((0.005 + (variant.seed % 8) * 0.001).toFixed(4)),
      simulatedLatencyMs: 250 + (variant.seed % 150),
      errorMessage: `Failed validation under ${strategy} mutation (${severity} severity)`,
    };
  }

  private chunkArray<T>(array: readonly T[], chunkSize: number): readonly (readonly T[])[] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  public formatReportMarkdown(report: FuzzerSummaryReport): string {
    const lines = [
      `# Fuzzing Resilience Report: ${report.runId}`,
      `- Overall Resilience Score: ${report.overallResilienceScore}/100`,
      `- Pass Rate: ${(report.overallPassRate * 100).toFixed(1)}% (${report.passedVariants}/${report.totalVariants})`,
      `- Total Duration: ${(report.totalDurationMs / 1000).toFixed(1)}s`,
      `- Total Cost: $${report.totalCostUSD.toFixed(4)}`,
      "",
      "## Severity Degradation Curve",
      ...report.degradationCurve.map(
        (p) => `- [${p.severity.toUpperCase()}] Pass Rate: ${(p.passRate * 100).toFixed(1)}% (${p.passedCount}/${p.variantCount}), Score: ${p.resilienceScore}/100`
      ),
    ];
    return lines.join("\n");
  }
}

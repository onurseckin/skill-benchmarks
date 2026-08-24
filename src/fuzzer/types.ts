import type {
  ScenarioDefinition,
  RunTerminationReason,
  TokenUsage,
  ExecutionLimits,
} from "../runner/types.js";

export type FuzzingStrategy =
  | "prompt_injection"
  | "adversarial_perturbation"
  | "concurrency_race"
  | "boundary_values"
  | "syntax_corruption"
  | "schema_corruption"
  | "environment_chaos"
  | "token_pressure"
  | "semantic_drift";

export type MutationSeverity = "low" | "medium" | "high" | "critical";

export type MutationSeverityLevel = 1 | 2 | 3 | 4;

export type ScenarioAstNodeType =
  | "scenario_root"
  | "metadata"
  | "instructions"
  | "workspace"
  | "fixture"
  | "limits"
  | "evaluation"
  | "check";

export interface ScenarioAstNode {
  readonly type: ScenarioAstNodeType;
  readonly name: string;
  readonly value?: unknown;
  readonly children?: readonly ScenarioAstNode[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PerturbationOptions {
  readonly typoRate?: number;
  readonly homoglyphRate?: number;
  readonly whitespaceJitter?: boolean;
  readonly delimiterCollision?: boolean;
  readonly tokenTruncationLength?: number;
  readonly concurrencyJitterMs?: number;
  readonly injectedPayloads?: readonly string[];
  readonly corruptEnvironment?: boolean;
  readonly corruptFixtures?: boolean;
  readonly boundaryLimitMultiplier?: number;
  readonly dropRequiredFiles?: boolean;
  readonly injectSyntaxErrors?: boolean;
  readonly seed?: number;
}

export interface MutationOperator {
  readonly id: string;
  readonly name: string;
  readonly strategy: FuzzingStrategy;
  readonly severity: MutationSeverity;
  readonly description: string;
}

export interface MutationRecord {
  readonly operatorId: string;
  readonly strategy: FuzzingStrategy;
  readonly severity: MutationSeverity;
  readonly targetPath: string;
  readonly originalValue: string;
  readonly mutatedValue: string;
  readonly appliedAt: number;
}

export interface MutatedScenarioVariant {
  readonly variantId: string;
  readonly baseScenarioId: string;
  readonly strategy: FuzzingStrategy;
  readonly severity: MutationSeverity;
  readonly seed: number;
  readonly mutations: readonly MutationRecord[];
  readonly mutatedDefinition: ScenarioDefinition;
  readonly generatedAt: string;
}

export type FailureCategory =
  | "none"
  | "syntax_error"
  | "assertion_failure"
  | "timeout"
  | "budget_exceeded"
  | "tool_loop"
  | "crash"
  | "jailbreak_triggered"
  | "hallucination";

export interface VariantExecutionResult {
  readonly variantId: string;
  readonly baseScenarioId: string;
  readonly strategy: FuzzingStrategy;
  readonly severity: MutationSeverity;
  readonly modelId: string;
  readonly skillId: string;
  readonly passed: boolean;
  readonly score: number;
  readonly terminationReason: RunTerminationReason;
  readonly failureCategory: FailureCategory;
  readonly durationMs: number;
  readonly costUSD: number;
  readonly tokens: TokenUsage;
  readonly turns: number;
  readonly mutationsCount: number;
  readonly errorMessage?: string;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface ResilienceMetrics {
  readonly basePassRate: number;
  readonly fuzzedPassRate: number;
  readonly degradationDelta: number;
  readonly resilienceScore: number;
  readonly passThroughRatio: number;
  readonly latencyShiftMs: number;
  readonly tokenOverheadRatio: number;
  readonly costOverheadRatio: number;
  readonly vulnerabilityCount: number;
}

export interface SeverityDegradationPoint {
  readonly severity: MutationSeverity;
  readonly severityLevel: MutationSeverityLevel;
  readonly variantCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly passRate: number;
  readonly resilienceScore: number;
  readonly averageDurationMs: number;
  readonly averageCostUSD: number;
}

export interface StrategyBreakdown {
  readonly strategy: FuzzingStrategy;
  readonly variantCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly passRate: number;
  readonly resilienceScore: number;
  readonly topFailureReasons: readonly string[];
}

export interface FuzzVulnerabilityReport {
  readonly variantId: string;
  readonly baseScenarioId: string;
  readonly strategy: FuzzingStrategy;
  readonly severity: MutationSeverity;
  readonly issue: string;
  readonly failureCategory: FailureCategory;
  readonly appliedMutations: readonly MutationRecord[];
}

export interface FuzzRunConfig {
  readonly scenarioIds: readonly string[];
  readonly skillIds: readonly string[];
  readonly modelIds: readonly string[];
  readonly strategies?: readonly FuzzingStrategy[];
  readonly severities?: readonly MutationSeverity[];
  readonly mutationsPerScenario?: number;
  readonly seed?: number;
  readonly concurrency?: number;
  readonly maxTurns?: number;
  readonly timeoutSeconds?: number;
  readonly dbPath?: string;
  readonly outputFormat?: string;
  readonly outputPath?: string;
  readonly verbose?: boolean;
}

export type FuzzEventType =
  | "fuzz:start"
  | "fuzz:variant:start"
  | "fuzz:variant:complete"
  | "fuzz:variant:error"
  | "fuzz:complete";

export interface FuzzEvent {
  readonly type: FuzzEventType;
  readonly variantId?: string;
  readonly scenarioId?: string;
  readonly strategy?: FuzzingStrategy;
  readonly severity?: MutationSeverity;
  readonly passed?: boolean;
  readonly message: string;
  readonly timestamp: number;
}

export type FuzzEventListener = (event: FuzzEvent) => void;

export interface FuzzerSummaryReport {
  readonly runId: string;
  readonly timestamp: string;
  readonly totalVariants: number;
  readonly passedVariants: number;
  readonly failedVariants: number;
  readonly baselinePassRate: number;
  readonly overallPassRate: number;
  readonly degradationDelta: number;
  readonly overallResilienceScore: number;
  readonly totalDurationMs: number;
  readonly totalCostUSD: number;
  readonly strategyBreakdowns: readonly StrategyBreakdown[];
  readonly degradationCurve: readonly SeverityDegradationPoint[];
  readonly variantResults: readonly VariantExecutionResult[];
  readonly vulnerabilities: readonly FuzzVulnerabilityReport[];
}

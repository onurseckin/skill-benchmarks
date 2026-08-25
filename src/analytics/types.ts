export type TrajectoryStepType =
  | "action"
  | "observation"
  | "thought"
  | "system"
  | "error"
  | "state_change";

export type TrajectoryActionType =
  | "tool_execution"
  | "file_modification"
  | "command_run"
  | "code_edit"
  | "query"
  | "subagent_spawn"
  | "message_send"
  | "final_answer";

export type TrajectoryOutcome =
  | "success"
  | "failure"
  | "partial_success"
  | "timeout"
  | "cancelled"
  | "deadlock";

export type AnomalySeverity = "info" | "low" | "medium" | "high" | "critical";

export type TrajectoryAnomalyType =
  | "infinite_retry_loop"
  | "tool_hallucination"
  | "context_forgetting"
  | "deadlock"
  | "format_drift"
  | "unhandled_error_cycle"
  | "token_waste"
  | "oscillating_edits"
  | "stalled_execution";

export type FailureCategory =
  | "environment_error"
  | "model_capability"
  | "context_truncation"
  | "protocol_violation"
  | "deadlock_or_stall"
  | "unknown_failure";

export interface StepTokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd?: number;
}

export interface StepSystemMetrics {
  readonly cpuPercent?: number;
  readonly memoryMb?: number;
  readonly diskReadKb?: number;
  readonly diskWriteKb?: number;
  readonly networkRxKb?: number;
  readonly networkTxKb?: number;
}

export interface StepErrorInfo {
  readonly code?: string;
  readonly message: string;
  readonly stack?: string;
  readonly isFatal: boolean;
}

export interface TrajectoryStep {
  readonly stepIndex: number;
  readonly timestampMs: number;
  readonly type: TrajectoryStepType;
  readonly actionType?: TrajectoryActionType;
  readonly turnIndex: number;
  readonly toolName?: string;
  readonly toolInput?: Readonly<Record<string, unknown>>;
  readonly toolOutput?: string;
  readonly command?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly filesAffected?: readonly string[];
  readonly diffSummary?: string;
  readonly thoughtContent?: string;
  readonly tokens?: StepTokenUsage;
  readonly systemMetrics?: StepSystemMetrics;
  readonly error?: StepErrorInfo;
  readonly latencyMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SemanticTrajectory {
  readonly trajectoryId: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly skillId?: string;
  readonly modelId: string;
  readonly providerId?: string;
  readonly startTime: string;
  readonly endTime?: string;
  readonly totalDurationMs: number;
  readonly outcome: TrajectoryOutcome;
  readonly steps: readonly TrajectoryStep[];
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly peakMemoryMb?: number;
  readonly finalOutput?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TrajectoryAnomaly {
  readonly id: string;
  readonly type: TrajectoryAnomalyType;
  readonly severity: AnomalySeverity;
  readonly stepIndices: readonly number[];
  readonly description: string;
  readonly confidence: number;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly suggestedMitigation?: string;
}

export interface TrajectoryTelemetryMetrics {
  readonly totalSteps: number;
  readonly totalTokens: number;
  readonly totalDurationMs: number;
  readonly toolCallCount: number;
  readonly errorCount: number;
  readonly duplicateToolCallCount: number;
  readonly tokenConsumptionRatePerStep: number;
  readonly retryRatio: number;
  readonly oscillationScore: number;
  readonly averageLatencyMs: number;
}

export interface AnomalyDetectorConfig {
  readonly maxConsecutiveIdenticalCalls?: number;
  readonly maxRepeatingErrorCycles?: number;
  readonly repeatingArgSimilarityThreshold?: number;
  readonly tokenWasteThreshold?: number;
  readonly maxIdleLatencyMs?: number;
  readonly knownToolNames?: readonly string[];
  readonly expectedOutputPatterns?: readonly RegExp[];
  readonly strictFormatDriftDetection?: boolean;
}

export interface AnomalyDetectionResult {
  readonly trajectoryId: string;
  readonly anomalies: readonly TrajectoryAnomaly[];
  readonly anomalyCountByType: Readonly<Record<TrajectoryAnomalyType, number>>;
  readonly totalSeverityScore: number;
  readonly telemetry: TrajectoryTelemetryMetrics;
  readonly hasCriticalAnomalies: boolean;
  readonly analysisDurationMs: number;
}

export interface FailureRootCause {
  readonly category: FailureCategory;
  readonly subCategory: string;
  readonly primaryFactor: string;
  readonly confidence: number;
  readonly triggerStepIndex?: number;
  readonly contributingAnomalies: readonly string[];
  readonly detailedExplanation: string;
  readonly remediationSuggestions: readonly string[];
}

export interface FailureClassificationResult {
  readonly trajectoryId: string;
  readonly outcome: TrajectoryOutcome;
  readonly isFailure: boolean;
  readonly rootCause?: FailureRootCause;
  readonly secondaryCauses: readonly FailureRootCause[];
  readonly confidenceScore: number;
  readonly diagnosticSummary: string;
  readonly classifiedAt: string;
}

export interface TrajectoryDiagnosticSummary {
  readonly trajectoryId: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly modelId: string;
  readonly skillId?: string;
  readonly outcome: TrajectoryOutcome;
  readonly durationMs: number;
  readonly healthScore: number;
  readonly anomalies: readonly TrajectoryAnomaly[];
  readonly classification: FailureClassificationResult;
  readonly telemetry: TrajectoryTelemetryMetrics;
  readonly recommendations: readonly string[];
}

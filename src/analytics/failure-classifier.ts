import type {
  SemanticTrajectory,
  TrajectoryAnomaly,
  FailureClassificationResult,
  FailureRootCause,
  FailureCategory,
  TrajectoryDiagnosticSummary,
  TrajectoryOutcome,
} from "./types.js";
import { TrajectoryAnomalyDetector } from "./index.js";

const ENV_PATTERNS: readonly { readonly pattern: RegExp; readonly subCategory: string; readonly factor: string }[] = [
  { pattern: /ENOMEM|out of memory|killed: 9|SIGKILL|cgroup limit/i, subCategory: "resource_limit_exceeded", factor: "Process terminated due to memory or resource exhaustion" },
  { pattern: /ETIMEDOUT|ECONNREFUSED|getaddrinfo ENOTFOUND|network unreachable/i, subCategory: "network_or_io_failure", factor: "Network connection failure or timeout" },
  { pattern: /EACCES|EPERM|permission denied|operation not permitted/i, subCategory: "permission_denied", factor: "Filesystem or environment permission denied" },
  { pattern: new RegExp("command not found|no such file or directory.*\\/bin\\/", "i"), subCategory: "missing_system_dependency", factor: "Required system binary or dependency is missing from environment" },
  { pattern: /timed out after \d+ms|operation timed out/i, subCategory: "infrastructure_timeout", factor: "Execution exceeded environment wall-clock timeout" },
];

const MODEL_PATTERNS: readonly { readonly pattern: RegExp; readonly subCategory: string; readonly factor: string }[] = [
  { pattern: /SyntaxError|ParseError|unexpected token/i, subCategory: "syntax_or_compile_error", factor: "Model generated code with syntax or compilation errors" },
  { pattern: /TypeError:.*is not a function|ReferenceError/i, subCategory: "logic_or_reasoning_flaw", factor: "Model generated erroneous method invocation or missing reference" },
  { pattern: /unrecognized argument|invalid choice/i, subCategory: "instruction_non_compliance", factor: "Model passed invalid CLI arguments or options" },
];

export class FailureModeClassifier {
  private readonly anomalyDetector: TrajectoryAnomalyDetector;

  public constructor(anomalyDetector?: TrajectoryAnomalyDetector) {
    this.anomalyDetector = anomalyDetector ?? new TrajectoryAnomalyDetector();
  }

  public classifyFailure(
    trajectory: SemanticTrajectory,
    providedAnomalies?: readonly TrajectoryAnomaly[]
  ): FailureClassificationResult {
    const anomalies =
      providedAnomalies ??
      this.anomalyDetector.detectAnomalies(trajectory).anomalies;

    const isFailure = trajectory.outcome !== "success";

    if (!isFailure) {
      return {
        trajectoryId: trajectory.trajectoryId,
        outcome: trajectory.outcome,
        isFailure: false,
        secondaryCauses: [],
        confidenceScore: 1.0,
        diagnosticSummary: "Execution succeeded without fatal failure modes.",
        classifiedAt: new Date().toISOString(),
      };
    }

    const identifiedCauses = this.identifyCandidateCauses(trajectory, anomalies);
    const sortedCauses = [...identifiedCauses].sort((a, b) => b.confidence - a.confidence);

    const primaryCause = sortedCauses[0] ?? {
      category: "unknown_failure" as FailureCategory,
      subCategory: "unclassified",
      primaryFactor: "Unable to definitively isolate root cause from telemetry",
      confidence: 0.3,
      contributingAnomalies: anomalies.map((a) => a.id),
      detailedExplanation: "No deterministic failure patterns matched the trajectory error trace.",
      remediationSuggestions: ["Enable verbose telemetry logging and inspect raw stderr streams."],
    };

    const secondaryCauses = sortedCauses.slice(1);
    const diagnosticSummary = `Primary Root Cause: [${primaryCause.category}:${primaryCause.subCategory}] ${primaryCause.primaryFactor}`;

    return {
      trajectoryId: trajectory.trajectoryId,
      outcome: trajectory.outcome,
      isFailure: true,
      rootCause: primaryCause,
      secondaryCauses,
      confidenceScore: primaryCause.confidence,
      diagnosticSummary,
      classifiedAt: new Date().toISOString(),
    };
  }

  public generateDiagnosticSummary(
    trajectory: SemanticTrajectory,
    providedAnomalies?: readonly TrajectoryAnomaly[]
  ): TrajectoryDiagnosticSummary {
    const detectionResult = providedAnomalies
      ? {
          trajectoryId: trajectory.trajectoryId,
          anomalies: providedAnomalies,
          anomalyCountByType: {} as never,
          totalSeverityScore: 0,
          telemetry: this.anomalyDetector.calculateTelemetry(
            trajectory.steps,
            trajectory.totalTokens,
            trajectory.totalDurationMs
          ),
          hasCriticalAnomalies: providedAnomalies.some((a) => a.severity === "critical"),
          analysisDurationMs: 0,
        }
      : this.anomalyDetector.detectAnomalies(trajectory);

    const classification = this.classifyFailure(trajectory, detectionResult.anomalies);
    const healthScore = this.computeHealthScore(trajectory.outcome, detectionResult.anomalies, detectionResult.telemetry);
    const recommendations = this.collectRecommendations(classification, detectionResult.anomalies);

    return {
      trajectoryId: trajectory.trajectoryId,
      runId: trajectory.runId,
      scenarioId: trajectory.scenarioId,
      modelId: trajectory.modelId,
      skillId: trajectory.skillId,
      outcome: trajectory.outcome,
      durationMs: trajectory.totalDurationMs,
      healthScore,
      anomalies: detectionResult.anomalies,
      classification,
      telemetry: detectionResult.telemetry,
      recommendations,
    };
  }

  private identifyCandidateCauses(
    trajectory: SemanticTrajectory,
    anomalies: readonly TrajectoryAnomaly[]
  ): readonly FailureRootCause[] {
    const causes: FailureRootCause[] = [];

    const loopAnomaly = anomalies.find((a) => a.type === "infinite_retry_loop");
    if (loopAnomaly) {
      causes.push({
        category: "model_capability",
        subCategory: "infinite_retry_or_loop",
        primaryFactor: "Model entered an unrecoverable action repetition loop",
        confidence: loopAnomaly.confidence,
        triggerStepIndex: loopAnomaly.stepIndices[0],
        contributingAnomalies: [loopAnomaly.id],
        detailedExplanation: loopAnomaly.description,
        remediationSuggestions: [
          "Inject diversity penalty or force alternative tool selection upon repeated failure",
          "Ensure error feedback contains distinct debugging hints",
        ],
      });
    }

    const hallucinationAnomaly = anomalies.find((a) => a.type === "tool_hallucination");
    if (hallucinationAnomaly) {
      causes.push({
        category: "model_capability",
        subCategory: "hallucination_or_invalid_tool",
        primaryFactor: "Model attempted to call non-existent or unprovided tools",
        confidence: hallucinationAnomaly.confidence,
        triggerStepIndex: hallucinationAnomaly.stepIndices[0],
        contributingAnomalies: [hallucinationAnomaly.id],
        detailedExplanation: hallucinationAnomaly.description,
        remediationSuggestions: [
          "Validate tool definitions in system prompt against model capability profile",
          "Add strict client-side tool schema validation with corrective retry prompts",
        ],
      });
    }

    const stallAnomaly = anomalies.find((a) => a.type === "stalled_execution" || a.type === "deadlock");
    if (stallAnomaly) {
      causes.push({
        category: "deadlock_or_stall",
        subCategory: "inactivity_timeout",
        primaryFactor: "Execution stalled or deadlocked waiting on external command or subprocess",
        confidence: stallAnomaly.confidence,
        triggerStepIndex: stallAnomaly.stepIndices[0],
        contributingAnomalies: [stallAnomaly.id],
        detailedExplanation: stallAnomaly.description,
        remediationSuggestions: [
          "Configure per-command timeout thresholds with forced process termination",
          "Monitor subprocess stdout streams for blocking interactive prompts",
        ],
      });
    }

    const formatAnomaly = anomalies.find((a) => a.type === "format_drift");
    if (formatAnomaly) {
      causes.push({
        category: "protocol_violation",
        subCategory: "format_drift",
        primaryFactor: "Model generated malformed output or breached formatting protocol",
        confidence: formatAnomaly.confidence,
        triggerStepIndex: formatAnomaly.stepIndices[0],
        contributingAnomalies: [formatAnomaly.id],
        detailedExplanation: formatAnomaly.description,
        remediationSuggestions: [
          "Reinforce XML or JSON delimiter requirements in prompt templates",
        ],
      });
    }

    const tokenWasteAnomaly = anomalies.find((a) => a.type === "token_waste");
    if (tokenWasteAnomaly && trajectory.totalTokens > 100000) {
      causes.push({
        category: "context_truncation",
        subCategory: "context_window_exceeded",
        primaryFactor: "Excessive token consumption degraded model attention and context retention",
        confidence: 0.8,
        triggerStepIndex: tokenWasteAnomaly.stepIndices[0],
        contributingAnomalies: [tokenWasteAnomaly.id],
        detailedExplanation: tokenWasteAnomaly.description,
        remediationSuggestions: [
          "Compress conversation history using rolling summaries",
          "Truncate verbose tool outputs before injecting into context window",
        ],
      });
    }

    for (const step of trajectory.steps) {
      const combinedText = (step.stderr ?? "") + " " + (step.error?.message ?? "");

      for (const envPattern of ENV_PATTERNS) {
        if (envPattern.pattern.test(combinedText)) {
          causes.push({
            category: "environment_error",
            subCategory: envPattern.subCategory,
            primaryFactor: envPattern.factor,
            confidence: 0.92,
            triggerStepIndex: step.stepIndex,
            contributingAnomalies: [],
            detailedExplanation: `Step ${step.stepIndex} failed with matching environment error: ${combinedText.substring(0, 160)}`,
            remediationSuggestions: [
              "Verify sandbox container resource limits and system permissions",
              "Pre-install missing system dependencies in benchmark environment image",
            ],
          });
        }
      }

      for (const modelPattern of MODEL_PATTERNS) {
        if (modelPattern.pattern.test(combinedText)) {
          causes.push({
            category: "model_capability",
            subCategory: modelPattern.subCategory,
            primaryFactor: modelPattern.factor,
            confidence: 0.85,
            triggerStepIndex: step.stepIndex,
            contributingAnomalies: [],
            detailedExplanation: `Step ${step.stepIndex} produced runtime exception: ${combinedText.substring(0, 160)}`,
            remediationSuggestions: [
              "Ensure agent performs localized syntax checking before file modification",
            ],
          });
        }
      }
    }

    return causes;
  }

  private computeHealthScore(
    outcome: TrajectoryOutcome,
    anomalies: readonly TrajectoryAnomaly[],
    telemetry: { readonly errorCount: number; readonly retryRatio: number }
  ): number {
    let score = outcome === "success" ? 100 : 50;

    for (const anomaly of anomalies) {
      switch (anomaly.severity) {
        case "critical":
          score -= 25;
          break;
        case "high":
          score -= 15;
          break;
        case "medium":
          score -= 8;
          break;
        case "low":
          score -= 4;
          break;
        case "info":
          score -= 1;
          break;
      }
    }

    score -= telemetry.errorCount * 3;
    score -= Math.round(telemetry.retryRatio * 20);

    return Math.max(0, Math.min(100, score));
  }

  private collectRecommendations(
    classification: FailureClassificationResult,
    anomalies: readonly TrajectoryAnomaly[]
  ): readonly string[] {
    const recs = new Set<string>();

    if (classification.rootCause) {
      for (const r of classification.rootCause.remediationSuggestions) {
        recs.add(r);
      }
    }

    for (const anomaly of anomalies) {
      if (anomaly.suggestedMitigation) {
        recs.add(anomaly.suggestedMitigation);
      }
    }

    if (recs.size === 0) {
      recs.add("Maintain existing trajectory execution protocols.");
    }

    return Array.from(recs);
  }
}

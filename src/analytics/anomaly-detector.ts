import type {
  SemanticTrajectory,
  TrajectoryStep,
  TrajectoryAnomaly,
  TrajectoryAnomalyType,
  AnomalySeverity,
  TrajectoryTelemetryMetrics,
  AnomalyDetectorConfig,
  AnomalyDetectionResult,
} from "./types.js";

const DEFAULT_MAX_CONSECUTIVE_IDENTICAL = 3;
const DEFAULT_MAX_ERROR_CYCLES = 3;
const DEFAULT_TOKEN_WASTE_THRESHOLD = 8000;
const DEFAULT_MAX_IDLE_LATENCY_MS = 60000;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return String(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(record[k])).join(",") + "}";
}

function calculateSeverityScore(severity: AnomalySeverity): number {
  switch (severity) {
    case "critical": return 10;
    case "high": return 7;
    case "medium": return 4;
    case "low": return 2;
    case "info": return 1;
  }
}

export class TrajectoryAnomalyDetector {
  private readonly config: Required<AnomalyDetectorConfig>;

  public constructor(config?: AnomalyDetectorConfig) {
    this.config = {
      maxConsecutiveIdenticalCalls: config?.maxConsecutiveIdenticalCalls ?? DEFAULT_MAX_CONSECUTIVE_IDENTICAL,
      maxRepeatingErrorCycles: config?.maxRepeatingErrorCycles ?? DEFAULT_MAX_ERROR_CYCLES,
      repeatingArgSimilarityThreshold: config?.repeatingArgSimilarityThreshold ?? 0.9,
      tokenWasteThreshold: config?.tokenWasteThreshold ?? DEFAULT_TOKEN_WASTE_THRESHOLD,
      maxIdleLatencyMs: config?.maxIdleLatencyMs ?? DEFAULT_MAX_IDLE_LATENCY_MS,
      knownToolNames: config?.knownToolNames ?? [
        "run_command", "read_file", "view_file", "write_to_file",
        "replace_file_content", "list_dir", "find_by_name", "grep_search",
        "read_url_content", "search_web", "send_message",
      ],
      expectedOutputPatterns: config?.expectedOutputPatterns ?? [],
      strictFormatDriftDetection: config?.strictFormatDriftDetection ?? false,
    };
  }

  public detectAnomalies(
    trajectory: SemanticTrajectory,
    overrideConfig?: AnomalyDetectorConfig
  ): AnomalyDetectionResult {
    const startTimestamp = Date.now();
    const cfg = overrideConfig ? new TrajectoryAnomalyDetector(overrideConfig).config : this.config;

    const allAnomalies: TrajectoryAnomaly[] = [
      ...this.scanInfiniteLoops(trajectory.steps, cfg.maxConsecutiveIdenticalCalls),
      ...this.scanToolHallucinations(trajectory.steps, cfg.knownToolNames),
      ...this.scanErrorCycles(trajectory.steps, cfg.maxRepeatingErrorCycles),
      ...this.scanFormatDrift(trajectory.steps, cfg.strictFormatDriftDetection),
      ...this.scanTokenWaste(trajectory.steps, cfg.tokenWasteThreshold),
      ...this.scanOscillatingEdits(trajectory.steps),
      ...this.scanStallsAndDeadlocks(trajectory.steps, cfg.maxIdleLatencyMs),
      ...this.scanContextForgetting(trajectory.steps),
    ];

    const anomalyCountByType: Record<TrajectoryAnomalyType, number> = {
      infinite_retry_loop: 0, tool_hallucination: 0, context_forgetting: 0,
      deadlock: 0, format_drift: 0, unhandled_error_cycle: 0,
      token_waste: 0, oscillating_edits: 0, stalled_execution: 0,
    };

    let totalSeverityScore = 0;
    let hasCriticalAnomalies = false;

    for (const anomaly of allAnomalies) {
      anomalyCountByType[anomaly.type] = (anomalyCountByType[anomaly.type] ?? 0) + 1;
      totalSeverityScore += calculateSeverityScore(anomaly.severity);
      if (anomaly.severity === "critical" || anomaly.severity === "high") {
        hasCriticalAnomalies = true;
      }
    }

    const telemetry = this.calculateTelemetry(
      trajectory.steps, trajectory.totalTokens, trajectory.totalDurationMs
    );

    return {
      trajectoryId: trajectory.trajectoryId,
      anomalies: allAnomalies,
      anomalyCountByType,
      totalSeverityScore,
      telemetry,
      hasCriticalAnomalies,
      analysisDurationMs: Date.now() - startTimestamp,
    };
  }

  public scanInfiniteLoops(steps: readonly TrajectoryStep[], maxConsecutive: number): readonly TrajectoryAnomaly[] {
    const anomalies: TrajectoryAnomaly[] = [];
    let consecutiveCount = 1;
    let lastKey = "";
    let loopSteps: number[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step) continue;
      const currentKey = (step.toolName ?? "") + ":" + (step.command ?? "") + ":" + stableStringify(step.toolInput ?? {});

      if (currentKey && currentKey === lastKey) {
        consecutiveCount++;
        loopSteps.push(step.stepIndex);
        if (consecutiveCount >= maxConsecutive) {
          anomalies.push({
            id: `anomaly-loop-${step.stepIndex}`,
            type: "infinite_retry_loop",
            severity: consecutiveCount >= maxConsecutive + 2 ? "critical" : "high",
            stepIndices: [...loopSteps],
            description: `Detected ${consecutiveCount} consecutive identical tool/command invocations with identical parameters`,
            confidence: 0.95,
            evidence: { invocationKey: currentKey, repetitionCount: consecutiveCount, stepIndices: [...loopSteps] },
            suggestedMitigation: "Implement exponential backoff or diversify action strategy upon repeated execution failure",
          });
        }
      } else {
        lastKey = currentKey;
        consecutiveCount = 1;
        loopSteps = [step.stepIndex];
      }
    }
    return anomalies;
  }

  public scanToolHallucinations(steps: readonly TrajectoryStep[], knownTools: readonly string[]): readonly TrajectoryAnomaly[] {
    const anomalies: TrajectoryAnomaly[] = [];
    const validToolSet = new Set(knownTools);

    for (const step of steps) {
      if (!step.toolName) continue;
      const isUnknown = !validToolSet.has(step.toolName);
      const isToolError =
        (step.stderr && /tool not found|unknown tool|is not recognized as a tool/i.test(step.stderr)) ||
        (step.error?.message && /tool not found|unknown tool/i.test(step.error.message));

      if (isUnknown || isToolError) {
        anomalies.push({
          id: `anomaly-hallucination-${step.stepIndex}`,
          type: "tool_hallucination",
          severity: "high",
          stepIndices: [step.stepIndex],
          description: `Invoked non-existent or unconfigured tool '${step.toolName}'`,
          confidence: isUnknown ? 0.99 : 0.85,
          evidence: { toolName: step.toolName, isUnknown, stderr: step.stderr },
          suggestedMitigation: "Enforce strict tool schema filtering before agent tool dispatch",
        });
      }
    }
    return anomalies;
  }

  public scanErrorCycles(steps: readonly TrajectoryStep[], maxCycles: number): readonly TrajectoryAnomaly[] {
    const anomalies: TrajectoryAnomaly[] = [];
    let consecutiveErrors = 0;
    let errorStepIndices: number[] = [];

    for (const step of steps) {
      const isError = step.type === "error" || (step.exitCode !== undefined && step.exitCode !== 0) || Boolean(step.error && step.error.isFatal);
      if (isError) {
        consecutiveErrors++;
        errorStepIndices.push(step.stepIndex);
        if (consecutiveErrors >= maxCycles) {
          anomalies.push({
            id: `anomaly-error-cycle-${step.stepIndex}`,
            type: "unhandled_error_cycle",
            severity: consecutiveErrors >= maxCycles * 2 ? "critical" : "high",
            stepIndices: [...errorStepIndices],
            description: `Encountered ${consecutiveErrors} consecutive unhandled execution errors without recovery`,
            confidence: 0.9,
            evidence: {
              consecutiveErrorCount: consecutiveErrors,
              lastErrorMessage: step.error?.message ?? step.stderr ?? "Command exited with non-zero status",
            },
            suggestedMitigation: "Introduce automated error reflection prompts when consecutive tool executions fail",
          });
        }
      } else {
        consecutiveErrors = 0;
        errorStepIndices = [];
      }
    }
    return anomalies;
  }

  public scanFormatDrift(steps: readonly TrajectoryStep[], strict: boolean): readonly TrajectoryAnomaly[] {
    const anomalies: TrajectoryAnomaly[] = [];
    for (const step of steps) {
      if (step.thoughtContent) {
        const hasUnescapedJson = /```json\s*\{[\s\S]*?\}\s*```/g.test(step.thoughtContent);
        const hasMalformedActionTag = /<action>[\s\S]*?(?!<\/action>)$/i.test(step.thoughtContent);
        if (hasMalformedActionTag || (strict && hasUnescapedJson)) {
          anomalies.push({
            id: `anomaly-format-${step.stepIndex}`,
            type: "format_drift",
            severity: "medium",
            stepIndices: [step.stepIndex],
            description: "Agent generated format drift or unclosed protocol block in thinking content",
            confidence: 0.8,
            evidence: { thoughtSnippet: step.thoughtContent.substring(0, 120) },
            suggestedMitigation: "Reinforce protocol delimiter rules in system prompt instructions",
          });
        }
      }
    }
    return anomalies;
  }

  public scanTokenWaste(steps: readonly TrajectoryStep[], thresholdTokens: number): readonly TrajectoryAnomaly[] {
    const anomalies: TrajectoryAnomaly[] = [];
    for (const step of steps) {
      if (step.tokens && step.tokens.totalTokens > thresholdTokens) {
        const isProductive = Boolean(step.filesAffected && step.filesAffected.length > 0) || Boolean(step.diffSummary && step.diffSummary.length > 0);
        if (!isProductive) {
          anomalies.push({
            id: `anomaly-token-waste-${step.stepIndex}`,
            type: "token_waste",
            severity: "medium",
            stepIndices: [step.stepIndex],
            description: `Step consumed ${step.tokens.totalTokens} tokens without producing tangible file or diff changes`,
            confidence: 0.75,
            evidence: { tokens: step.tokens.totalTokens, threshold: thresholdTokens },
            suggestedMitigation: "Prune long context histories and compress tool outputs before prompt construction",
          });
        }
      }
    }
    return anomalies;
  }

  public scanOscillatingEdits(steps: readonly TrajectoryStep[]): readonly TrajectoryAnomaly[] {
    const anomalies: TrajectoryAnomaly[] = [];
    const fileEditHistory: Record<string, number[]> = {};

    for (const step of steps) {
      if (step.actionType === "file_modification" || step.actionType === "code_edit") {
        const files = step.filesAffected ?? [];
        for (const file of files) {
          if (!fileEditHistory[file]) fileEditHistory[file] = [];
          fileEditHistory[file].push(step.stepIndex);
        }
      }
    }

    for (const [file, indices] of Object.entries(fileEditHistory)) {
      if (indices.length >= 4) {
        anomalies.push({
          id: `anomaly-oscillation-${indices[0]}`,
          type: "oscillating_edits",
          severity: "high",
          stepIndices: [...indices],
          description: `Detected ${indices.length} oscillating modifications to single file '${file}'`,
          confidence: 0.85,
          evidence: { targetFile: file, editCount: indices.length, stepIndices: indices },
          suggestedMitigation: "Ensure atomic single-pass edits with automated syntax validation before rewriting",
        });
      }
    }
    return anomalies;
  }

  public scanStallsAndDeadlocks(steps: readonly TrajectoryStep[], maxIdleLatencyMs: number): readonly TrajectoryAnomaly[] {
    const anomalies: TrajectoryAnomaly[] = [];
    for (const step of steps) {
      if (step.latencyMs > maxIdleLatencyMs) {
        anomalies.push({
          id: `anomaly-stall-${step.stepIndex}`,
          type: "stalled_execution",
          severity: step.latencyMs > maxIdleLatencyMs * 2 ? "critical" : "medium",
          stepIndices: [step.stepIndex],
          description: `Execution stalled for ${Math.round(step.latencyMs / 1000)}s exceeding latency budget`,
          confidence: 0.9,
          evidence: { latencyMs: step.latencyMs, thresholdMs: maxIdleLatencyMs },
          suggestedMitigation: "Enforce per-step execution timeouts and background watchdog monitoring",
        });
      }
    }
    return anomalies;
  }

  public scanContextForgetting(steps: readonly TrajectoryStep[]): readonly TrajectoryAnomaly[] {
    const anomalies: TrajectoryAnomaly[] = [];
    const readQueries = new Map<string, number>();

    for (const step of steps) {
      if (step.toolName === "grep_search" || step.toolName === "find_by_name" || step.toolName === "read_file") {
        const queryKey = (step.toolName ?? "") + ":" + stableStringify(step.toolInput ?? {});
        const previousIndex = readQueries.get(queryKey);
        if (previousIndex !== undefined && step.stepIndex - previousIndex > 10) {
          anomalies.push({
            id: `anomaly-forgetting-${step.stepIndex}`,
            type: "context_forgetting",
            severity: "low",
            stepIndices: [previousIndex, step.stepIndex],
            description: `Agent repeated identical exploration query '${step.toolName}' after 10+ intervening steps`,
            confidence: 0.7,
            evidence: { initialStep: previousIndex, repeatedStep: step.stepIndex, query: queryKey },
            suggestedMitigation: "Maintain a persistent knowledge buffer or scratchpad across multi-turn reasoning steps",
          });
        } else {
          readQueries.set(queryKey, step.stepIndex);
        }
      }
    }
    return anomalies;
  }

  public calculateTelemetry(
    steps: readonly TrajectoryStep[],
    totalTokens: number,
    totalDurationMs: number
  ): TrajectoryTelemetryMetrics {
    const totalSteps = steps.length;
    let toolCallCount = 0;
    let errorCount = 0;
    let duplicateToolCallCount = 0;
    let totalLatency = 0;
    const seenCalls = new Set<string>();

    for (const step of steps) {
      totalLatency += step.latencyMs;
      if (step.type === "action" || step.toolName) {
        toolCallCount++;
        const callKey = (step.toolName ?? "") + ":" + stableStringify(step.toolInput ?? {});
        if (seenCalls.has(callKey)) duplicateToolCallCount++;
        else seenCalls.add(callKey);
      }

      if (step.type === "error" || (step.exitCode !== undefined && step.exitCode !== 0) || Boolean(step.error)) {
        errorCount++;
      }
    }

    const tokenConsumptionRatePerStep = totalSteps > 0 ? Math.round(totalTokens / totalSteps) : 0;
    const retryRatio = toolCallCount > 0 ? Number((duplicateToolCallCount / toolCallCount).toFixed(4)) : 0;
    const oscillationScore = totalSteps > 0 ? Number((duplicateToolCallCount / totalSteps).toFixed(4)) : 0;
    const averageLatencyMs = totalSteps > 0 ? Math.round(totalLatency / totalSteps) : 0;

    return {
      totalSteps, totalTokens, totalDurationMs, toolCallCount,
      errorCount, duplicateToolCallCount, tokenConsumptionRatePerStep,
      retryRatio, oscillationScore, averageLatencyMs,
    };
  }
}

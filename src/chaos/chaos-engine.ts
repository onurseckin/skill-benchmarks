import type {
  ChaosEngineConfig,
  ChaosExecutionContext,
  ChaosExperimentReport,
  ChaosExperimentTimelineEvent,
  ChaosFault,
  ChaosFaultExecutionResult,
  ChaosPerturbationMatrix,
  ChaosSchedule,
  ChaosScheduleItem,
  IChaosEngine,
  IFaultInjector,
} from "./types.js";
import { ContainerFaultInjector } from "./fault-injector.js";

const DEFAULT_CONFIG: ChaosEngineConfig = {
  autoRollbackOnExit: true,
  maxConcurrentFaults: 4,
  safetyTimeoutMs: 120000,
  abortOnCatastrophicFailure: true,
};

export class ChaosEngine implements IChaosEngine {
  public readonly config: ChaosEngineConfig;
  private readonly faultInjector: IFaultInjector;

  public constructor(
    faultInjector?: IFaultInjector,
    config?: Partial<ChaosEngineConfig>
  ) {
    this.faultInjector = faultInjector ?? new ContainerFaultInjector();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public async executeExperiment<T>(
    scenarioId: string,
    schedule: ChaosSchedule,
    scenarioRunner: (context: ChaosExecutionContext) => Promise<T>
  ): Promise<{ readonly result: T; readonly report: ChaosExperimentReport }> {
    const experimentId = `exp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const startedAt = new Date().toISOString();
    const startTimeMs = Date.now();
    const timeline: ChaosExperimentTimelineEvent[] = [];
    const faultResults: ChaosFaultExecutionResult[] = [];
    const violations: string[] = [];
    const activeFaults: ChaosFault[] = [];

    const recordEvent = (
      phase: ChaosExperimentTimelineEvent["phase"],
      eventType: string,
      details: Readonly<Record<string, unknown>>
    ): void => {
      timeline.push({
        timestamp: new Date().toISOString(),
        elapsedMs: Date.now() - startTimeMs,
        phase,
        eventType,
        details,
      });
    };

    recordEvent("baseline", "EXPERIMENT_INITIALIZED", {
      experimentId,
      scenarioId,
      scheduleItemsCount: schedule.items.length,
    });

    const triggerFault = async (item: ChaosScheduleItem): Promise<void> => {
      if (activeFaults.length >= this.config.maxConcurrentFaults) {
        violations.push(`Max concurrent faults exceeded on ${item.id}`);
        return;
      }

      recordEvent("injection", "FAULT_INJECTION_TRIGGERED", {
        scheduleItemId: item.id,
        faultKind: item.fault.kind,
        severity: item.severity,
      });

      activeFaults.push(item.fault);
      try {
        const res = await this.faultInjector.inject(item.fault);
        faultResults.push(res);
        recordEvent("active_fault", "FAULT_ACTIVE", {
          scheduleItemId: item.id,
          status: res.status,
        });
      } catch (err) {
        violations.push(`Failed to inject fault ${item.id}: ${String(err)}`);
      }
    };

    const scheduleTimers: ReturnType<typeof setTimeout>[] = [];
    for (const item of schedule.items) {
      if (item.trigger.type === "time_elapsed") {
        const delay = item.trigger.delayMsAfterTrigger ?? 0;
        const timer = setTimeout(() => {
          void triggerFault(item);
        }, delay);
        scheduleTimers.push(timer);
      }
    }

    const context: ChaosExecutionContext = {
      experimentId,
      scenarioId,
      activeFaults,
      get elapsedMs(): number {
        return Date.now() - startTimeMs;
      },
      notifyTurnStart: async (turnIndex: number): Promise<void> => {
        recordEvent("active_fault", "TURN_START", { turnIndex });
        for (const item of schedule.items) {
          if (
            item.trigger.type === "turn_start" &&
            (item.trigger.turnIndex === undefined || item.trigger.turnIndex === turnIndex)
          ) {
            await triggerFault(item);
          }
        }
      },
      notifyTurnEnd: async (turnIndex: number): Promise<void> => {
        recordEvent("active_fault", "TURN_END", { turnIndex });
        for (const item of schedule.items) {
          if (
            item.trigger.type === "turn_end" &&
            (item.trigger.turnIndex === undefined || item.trigger.turnIndex === turnIndex)
          ) {
            await triggerFault(item);
          }
        }
      },
      notifyBeforeToolCall: async (toolName: string): Promise<void> => {
        recordEvent("active_fault", "BEFORE_TOOL_CALL", { toolName });
        for (const item of schedule.items) {
          if (
            item.trigger.type === "before_tool_call" &&
            (item.trigger.toolName === undefined || item.trigger.toolName === toolName)
          ) {
            await triggerFault(item);
          }
        }
      },
      notifyAfterToolCall: async (toolName: string): Promise<void> => {
        recordEvent("active_fault", "AFTER_TOOL_CALL", { toolName });
        for (const item of schedule.items) {
          if (
            item.trigger.type === "after_tool_call" &&
            (item.trigger.toolName === undefined || item.trigger.toolName === toolName)
          ) {
            await triggerFault(item);
          }
        }
      },
    };

    let runnerResult: T;
    try {
      runnerResult = await scenarioRunner(context);
      recordEvent("recovery", "SCENARIO_RUNNER_COMPLETED", {});
    } catch (err) {
      violations.push(`Scenario runner exception: ${String(err)}`);
      recordEvent("recovery", "SCENARIO_RUNNER_FAILED", {
        error: String(err),
      });
      if (this.config.abortOnCatastrophicFailure) {
        await this.faultInjector.restoreAll();
      }
      throw err;
    } finally {
      for (const t of scheduleTimers) {
        clearTimeout(t);
      }
      if (this.config.autoRollbackOnExit) {
        await this.faultInjector.restoreAll();
        recordEvent("post_check", "ALL_FAULTS_RESTORED", {});
      }
    }

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTimeMs;

    const report: ChaosExperimentReport = {
      experimentId,
      scenarioId,
      runId: experimentId,
      schedule,
      startedAt,
      completedAt,
      durationMs,
      faultResults,
      timeline,
      violations,
    };

    return { result: runnerResult, report };
  }

  public async executeMatrix<T>(
    matrix: ChaosPerturbationMatrix,
    scenarioRunner: (
      scenarioId: string,
      schedule: ChaosSchedule,
      context: ChaosExecutionContext
    ) => Promise<T>
  ): Promise<readonly ChaosExperimentReport[]> {
    const reports: ChaosExperimentReport[] = [];

    for (let rep = 0; rep < matrix.repetitions; rep++) {
      for (const scenarioId of matrix.scenarios) {
        for (const schedule of matrix.schedules) {
          const { report } = await this.executeExperiment(
            scenarioId,
            schedule,
            (context) => scenarioRunner(scenarioId, schedule, context)
          );
          reports.push(report);
        }
      }
    }

    return reports;
  }
}

export function createChaosEngine(
  faultInjector?: IFaultInjector,
  config?: Partial<ChaosEngineConfig>
): ChaosEngine {
  return new ChaosEngine(faultInjector, config);
}

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as os from "node:os";
import type {
  CheckpointConfig,
  CheckpointMetadata,
  CheckpointState,
  ICheckpointLedger,
  MatrixCellResult,
  SweepExecutionStatus,
} from "./types.js";
import type { TokenUsage } from "../runner/types.js";
import { BenchmarkArtifactValueStreamSanitizer } from "../shared/artifact-sanitization.js";
import { incompatibleSweepPlanMessage } from "./sweep-plan.js";
import { writeCheckpointSnapshot } from "./checkpoint-storage.js";

export const checkpointMetadataVersion = "2.0.0";

export class CheckpointLedger implements ICheckpointLedger {
  public readonly filePath: string;
  private readonly maxBackups: number;
  private readonly planFingerprint: string;
  private state: CheckpointState;
  private writeLock: Promise<void> = Promise.resolve();
  private readonly artifactSanitizer = new BenchmarkArtifactValueStreamSanitizer();

  constructor(
    filePath: string,
    initialSummary: {
      readonly sweepId: string;
      readonly scenarioIds: readonly string[];
      readonly skillIds: readonly string[];
      readonly modelIds: readonly string[];
      readonly repetitions: number;
      readonly totalPlannedCells: number;
      readonly planFingerprint: string;
      readonly sweepStartedAt: string;
    },
    config?: Partial<CheckpointConfig>
  ) {
    this.filePath = resolve(filePath);
    this.maxBackups = config?.maxBackups ?? 3;
    this.planFingerprint = initialSummary.planFingerprint;

    const metadata: CheckpointMetadata = {
      version: checkpointMetadataVersion,
      sweepId: initialSummary.sweepId,
      planFingerprint: initialSummary.planFingerprint,
      sweepStartedAt: initialSummary.sweepStartedAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hostArch: os.arch(),
      bunVersion: typeof Bun !== "undefined" ? Bun.version : "node",
    };

    const emptyTokens: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
    };

    this.state = {
      metadata,
      status: "pending" as SweepExecutionStatus,
      totalPlannedCells: initialSummary.totalPlannedCells,
      completedCellIds: [],
      failedCellIds: [],
      skippedCellIds: [],
      completedResults: {},
      totalTokens: emptyTokens,
      totalCostUSD: 0,
      wallClockDurationMs: 0,
      configSummary: {
        scenarioIds: initialSummary.scenarioIds,
        skillIds: initialSummary.skillIds,
        modelIds: initialSummary.modelIds,
        repetitions: initialSummary.repetitions,
      },
    };
  }

  async load(): Promise<CheckpointState | null> {
    const candidates = [this.filePath];
    for (let i = 1; i <= this.maxBackups; i++) candidates.push(`${this.filePath}.bak.${i}`);
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      try {
        const stats = lstatSync(candidate);
        if (!stats.isFile() || stats.isSymbolicLink()) throw new TypeError("Checkpoint evidence is unsafe");
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as CheckpointState;
        this.assertCompatibleCheckpoint(parsed);
        this.state = parsed;
        return parsed;
      } catch (error) {
        if (error instanceof TypeError) throw error;
      }
    }
    return null;
  }

  async save(state: CheckpointState): Promise<void> {
    await this.persistState(() => state);
  }

  private async persistState(createState: (current: CheckpointState) => CheckpointState): Promise<void> {
    let releaseLock: () => void = () => {};
    const previousLock = this.writeLock;
    this.writeLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    await previousLock;

    try {
      const state = createState(this.state);
      const updatedState: CheckpointState = {
        ...state,
        metadata: {
          ...state.metadata,
          updatedAt: new Date().toISOString(),
        },
      };
      const serialized = JSON.stringify(this.artifactSanitizer.sanitize(updatedState), null, 2);
      writeCheckpointSnapshot(this.filePath, serialized, this.maxBackups);
      this.state = updatedState;
    } finally {
      releaseLock();
    }
  }

  async recordCellSuccess(result: MatrixCellResult): Promise<void> {
    const cellId = result.cell.cellId;
    const cellTokens = result.scenarioResult?.totalTokens ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
    };

    const cellCost = result.scenarioResult?.totalCostUSD ?? result.runRecord?.totalCostUSD ?? 0;
    await this.persistState((current) => {
      const completedSet = new Set(current.completedCellIds);
      completedSet.add(cellId);
      const prevTokens = current.totalTokens;
      const completedResults = { ...current.completedResults, [cellId]: result };
      const newTokens: TokenUsage = {
        inputTokens: prevTokens.inputTokens + cellTokens.inputTokens,
        outputTokens: prevTokens.outputTokens + cellTokens.outputTokens,
        cacheCreationInputTokens: prevTokens.cacheCreationInputTokens + cellTokens.cacheCreationInputTokens,
        cacheReadInputTokens: prevTokens.cacheReadInputTokens + cellTokens.cacheReadInputTokens,
        totalTokens: prevTokens.totalTokens + cellTokens.totalTokens,
      };
      return {
        ...current,
        status: resolveCheckpointStatus(current, completedSet, new Set(current.failedCellIds), new Set(current.skippedCellIds), completedResults),
        completedCellIds: Array.from(completedSet),
        completedResults,
        totalTokens: newTokens,
        totalCostUSD: current.totalCostUSD + cellCost,
        wallClockDurationMs: current.wallClockDurationMs + result.durationMs,
      };
    });
  }

  async recordCellFailure(result: MatrixCellResult): Promise<void> {
    const cellId = result.cell.cellId;
    await this.persistState((current) => {
      const failedSet = new Set(current.failedCellIds);
      failedSet.add(cellId);
      const completedResults = { ...current.completedResults, [cellId]: result };
      return {
        ...current,
        status: resolveCheckpointStatus(current, new Set(current.completedCellIds), failedSet, new Set(current.skippedCellIds), completedResults),
        failedCellIds: Array.from(failedSet),
        completedResults,
        wallClockDurationMs: current.wallClockDurationMs + result.durationMs,
      };
    });
  }

  async recordCellSkipped(result: MatrixCellResult): Promise<void> {
    const cellId = result.cell.cellId;
    await this.persistState((current) => {
      const skippedSet = new Set(current.skippedCellIds);
      skippedSet.add(cellId);
      const completedResults = { ...current.completedResults, [cellId]: result };
      return {
        ...current,
        status: resolveCheckpointStatus(current, new Set(current.completedCellIds), new Set(current.failedCellIds), skippedSet, completedResults),
        skippedCellIds: Array.from(skippedSet),
        completedResults,
      };
    });
  }

  isCellCompleted(cellId: string): boolean {
    return this.state.completedCellIds.includes(cellId) || this.state.skippedCellIds.includes(cellId);
  }

  getCompletedResults(): readonly MatrixCellResult[] {
    return Object.values(this.state.completedResults);
  }

  getState(): CheckpointState {
    return this.state;
  }

  private assertCompatibleCheckpoint(state: CheckpointState): void {
    if (state.metadata.planFingerprint !== this.planFingerprint) {
      throw new TypeError(incompatibleSweepPlanMessage);
    }
  }
}

function resolveCheckpointStatus(
  current: CheckpointState,
  completedIds: ReadonlySet<string>,
  failedIds: ReadonlySet<string>,
  skippedIds: ReadonlySet<string>,
  results: Readonly<Record<string, MatrixCellResult>>
): SweepExecutionStatus {
  const terminalIds = new Set([...completedIds, ...failedIds, ...skippedIds]);
  if (terminalIds.size < current.totalPlannedCells) return "running";
  if (failedIds.size === 0) return "completed";
  const allFailuresAborted = [...failedIds].every((cellId) => results[cellId]?.runRecord?.terminationReason === "aborted");
  return allFailuresAborted ? "aborted" : "failed";
}

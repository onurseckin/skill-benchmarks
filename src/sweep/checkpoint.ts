import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
import { sanitizeBenchmarkArtifactValue } from "../shared/artifact-sanitization.js";
import { incompatibleSweepPlanMessage } from "./sweep-plan.js";

const DEFAULT_METADATA_VERSION = "1.0.0";

export class CheckpointLedger implements ICheckpointLedger {
  public readonly filePath: string;
  private readonly maxBackups: number;
  private readonly planFingerprint: string;
  private state: CheckpointState;
  private writeLock: Promise<void> = Promise.resolve();

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
    },
    config?: Partial<CheckpointConfig>
  ) {
    this.filePath = resolve(filePath);
    this.maxBackups = config?.maxBackups ?? 3;
    this.planFingerprint = initialSummary.planFingerprint;

    const metadata: CheckpointMetadata = {
      version: DEFAULT_METADATA_VERSION,
      sweepId: initialSummary.sweepId,
      planFingerprint: initialSummary.planFingerprint,
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

  private ensureDirectoryExists(targetPath: string): void {
    const parentDir = dirname(targetPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
  }

  private rotateBackups(): void {
    if (this.maxBackups <= 0 || !existsSync(this.filePath)) {
      return;
    }

    for (let i = this.maxBackups - 1; i >= 1; i--) {
      const srcBackup = `${this.filePath}.bak.${i}`;
      const dstBackup = `${this.filePath}.bak.${i + 1}`;
      if (existsSync(srcBackup)) {
        try {
          renameSync(srcBackup, dstBackup);
        } catch {
        }
      }
    }

    const firstBackup = `${this.filePath}.bak.1`;
    try {
      if (existsSync(this.filePath)) {
        const content = readFileSync(this.filePath, "utf8");
        writeFileSync(firstBackup, content, "utf8");
      }
    } catch {
    }
  }

  async load(): Promise<CheckpointState | null> {
    const candidates = [this.filePath];
    for (let i = 1; i <= this.maxBackups; i++) candidates.push(`${this.filePath}.bak.${i}`);
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as CheckpointState;
        this.assertCompatibleCheckpoint(parsed);
        this.state = parsed;
        return parsed;
      } catch (error) {
        if (error instanceof TypeError && error.message === incompatibleSweepPlanMessage) throw error;
      }
    }
    return null;
  }

  async save(state: CheckpointState): Promise<void> {
    let releaseLock: () => void = () => {};
    const previousLock = this.writeLock;
    this.writeLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    await previousLock;

    try {
      const updatedState: CheckpointState = {
        ...state,
        metadata: {
          ...state.metadata,
          updatedAt: new Date().toISOString(),
        },
      };
      this.state = updatedState;

      this.ensureDirectoryExists(this.filePath);
      this.rotateBackups();

      const tmpPath = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
      const serialized = JSON.stringify(sanitizeBenchmarkArtifactValue(updatedState), null, 2);

      writeFileSync(tmpPath, serialized, "utf8");
      renameSync(tmpPath, this.filePath);
    } catch (err) {
      throw err;
    } finally {
      releaseLock();
    }
  }

  async recordCellSuccess(result: MatrixCellResult): Promise<void> {
    const cellId = result.cell.cellId;
    const completedSet = new Set(this.state.completedCellIds);
    completedSet.add(cellId);

    const prevTokens = this.state.totalTokens;
    const cellTokens = result.scenarioResult?.totalTokens ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
    };

    const newTokens: TokenUsage = {
      inputTokens: prevTokens.inputTokens + cellTokens.inputTokens,
      outputTokens: prevTokens.outputTokens + cellTokens.outputTokens,
      cacheCreationInputTokens: prevTokens.cacheCreationInputTokens + cellTokens.cacheCreationInputTokens,
      cacheReadInputTokens: prevTokens.cacheReadInputTokens + cellTokens.cacheReadInputTokens,
      totalTokens: prevTokens.totalTokens + cellTokens.totalTokens,
    };

    const cellCost = result.scenarioResult?.totalCostUSD ?? result.runRecord?.totalCostUSD ?? 0;
    const newResults = {
      ...this.state.completedResults,
      [cellId]: result,
    };

    const updatedState: CheckpointState = {
      ...this.state,
      completedCellIds: Array.from(completedSet),
      completedResults: newResults,
      totalTokens: newTokens,
      totalCostUSD: this.state.totalCostUSD + cellCost,
      wallClockDurationMs: this.state.wallClockDurationMs + result.durationMs,
    };

    await this.save(updatedState);
  }

  async recordCellFailure(result: MatrixCellResult): Promise<void> {
    const cellId = result.cell.cellId;
    const failedSet = new Set(this.state.failedCellIds);
    failedSet.add(cellId);

    const newResults = {
      ...this.state.completedResults,
      [cellId]: result,
    };

    const updatedState: CheckpointState = {
      ...this.state,
      failedCellIds: Array.from(failedSet),
      completedResults: newResults,
      wallClockDurationMs: this.state.wallClockDurationMs + result.durationMs,
    };

    await this.save(updatedState);
  }

  async recordCellSkipped(result: MatrixCellResult): Promise<void> {
    const cellId = result.cell.cellId;
    const skippedSet = new Set(this.state.skippedCellIds);
    skippedSet.add(cellId);

    const newResults = {
      ...this.state.completedResults,
      [cellId]: result,
    };

    const updatedState: CheckpointState = {
      ...this.state,
      skippedCellIds: Array.from(skippedSet),
      completedResults: newResults,
    };

    await this.save(updatedState);
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

import type { MatrixCellDescriptor, MatrixCellResult, MatrixSweepConfig } from "./types.js";
import { waitForRetry } from "../shared/cancellation.js";

export interface SweepWorkerPoolInput {
  readonly cells: readonly MatrixCellDescriptor[];
  readonly config: MatrixSweepConfig;
  readonly maxGlobalConcurrency: number;
  readonly signal: AbortSignal;
  readonly waitIfPaused: () => Promise<void>;
  readonly shouldSkip: (cell: MatrixCellDescriptor) => boolean;
  readonly updateInFlight: (count: number) => void;
  readonly executeCell: (cell: MatrixCellDescriptor) => Promise<MatrixCellResult>;
  readonly terminalizeAbortedCell: (cell: MatrixCellDescriptor) => Promise<void>;
}

export async function runSweepWorkerPool(input: SweepWorkerPoolInput): Promise<void> {
  const cellQueue = [...input.cells];
  const modelInFlight = new Map<string, number>();
  const providerInFlight = new Map<string, number>();

  const executeScheduledCell = async (cell: MatrixCellDescriptor): Promise<void> => {
    if (input.shouldSkip(cell)) {
      await input.executeCell(cell);
      return;
    }
    input.updateInFlight(1);
    modelInFlight.set(cell.modelId, (modelInFlight.get(cell.modelId) ?? 0) + 1);
    providerInFlight.set(cell.providerId, (providerInFlight.get(cell.providerId) ?? 0) + 1);
    try {
      await input.executeCell(cell);
    } finally {
      input.updateInFlight(-1);
      modelInFlight.set(cell.modelId, Math.max(0, (modelInFlight.get(cell.modelId) ?? 1) - 1));
      providerInFlight.set(
        cell.providerId,
        Math.max(0, (providerInFlight.get(cell.providerId) ?? 1) - 1),
      );
    }
  };

  const runWorker = async (): Promise<void> => {
    while (cellQueue.length > 0 && !input.signal.aborted) {
      await input.waitIfPaused();
      if (input.signal.aborted) return;
      const index = cellQueue.findIndex((cell) => {
        const modelCount = modelInFlight.get(cell.modelId) ?? 0;
        const providerCount = providerInFlight.get(cell.providerId) ?? 0;
        const maxModel =
          cell.modelEntry.concurrencyLimit ??
          input.config.concurrency?.maxPerModelConcurrency ??
          10;
        const maxProvider = input.config.concurrency?.maxPerProviderConcurrency ?? 20;
        return modelCount < maxModel && providerCount < maxProvider;
      });
      if (index === -1) {
        try {
          await waitForRetry(50, input.signal);
        } catch {
          if (input.signal.aborted) return;
          throw new Error("Sweep worker wait failed");
        }
        continue;
      }
      const cell = cellQueue.splice(index, 1)[0];
      if (cell !== undefined) await executeScheduledCell(cell);
    }
  };

  const workerCount = Math.min(input.maxGlobalConcurrency, input.cells.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  if (!input.signal.aborted) return;
  while (cellQueue.length > 0) {
    const cell = cellQueue.shift();
    if (cell === undefined) continue;
    if (input.shouldSkip(cell)) await input.executeCell(cell);
    else await input.terminalizeAbortedCell(cell);
  }
}

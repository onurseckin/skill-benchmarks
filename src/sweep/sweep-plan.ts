import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { MatrixCellDescriptor, MatrixSweepConfig } from "./types.js";

export const incompatibleSweepPlanMessage = "Sweep plan is incompatible with the existing sweep identity";
export const occupiedSweepNamespaceMessage = "Sweep identity already owns an existing benchmark namespace";

interface SweepPlanFingerprintInput {
  readonly sweepId: string;
  readonly checkpointPath: string;
  readonly telemetryDbPath: string;
  readonly config: MatrixSweepConfig;
  readonly cells: readonly MatrixCellDescriptor[];
}

interface SweepPlanBinding {
  readonly version: "1";
  readonly sweepId: string;
  readonly fingerprint: string;
}

export function createSweepPlanFingerprint(input: SweepPlanFingerprintInput): string {
  const fingerprintInput = {
    sweepId: input.sweepId,
    outputRoot: resolve(input.config.runtimeConfig.outputRoot),
    checkpointPath: resolve(input.checkpointPath),
    telemetryDbPath: resolve(input.telemetryDbPath),
    dryRun: input.config.dryRun === true,
    maxRetriesPerCell: input.config.maxRetriesPerCell ?? 2,
    stopOnFirstFailure: input.config.stopOnFirstFailure === true,
    workspaceRoot: input.config.workspaceRoot === undefined ? null : resolve(input.config.workspaceRoot),
    usesContainerPool: input.config.containerPool !== undefined,
    concurrency: {
      maxGlobalConcurrency: input.config.concurrency?.maxGlobalConcurrency ?? 4,
      maxPerModelConcurrency: input.config.concurrency?.maxPerModelConcurrency ?? 10,
      maxPerProviderConcurrency: input.config.concurrency?.maxPerProviderConcurrency ?? 20,
      maxPerScenarioConcurrency: input.config.concurrency?.maxPerScenarioConcurrency ?? null,
      containerAcquisitionTimeoutMs: input.config.concurrency?.containerAcquisitionTimeoutMs ?? null,
      queuePollIntervalMs: input.config.concurrency?.queuePollIntervalMs ?? null,
    },
    rateLimits: input.config.rateLimits ?? [],
    models: input.config.models.map((model) => ({
      modelId: model.modelId,
      providerId: model.providerId,
      embeddedProvider: model.provider === undefined ? null : {
        providerId: model.provider.providerId,
        modelId: model.provider.modelId,
        executionMode: model.provider.executionMode ?? null,
        simulated: model.provider.simulated ?? null,
      },
      displayName: model.displayName ?? null,
      temperature: model.temperature ?? null,
      topP: model.topP ?? null,
      maxTokens: model.maxTokens ?? null,
      thinkingLevel: model.thinkingLevel ?? null,
      thinkingBudget: model.thinkingBudget ?? null,
      reasoningEffort: model.reasoningEffort ?? null,
      concurrencyLimit: model.concurrencyLimit ?? null,
      rateLimit: model.rateLimit ?? null,
      tags: model.tags ?? [],
      metadata: model.metadata ?? {},
    })),
    cells: input.cells.map((cell) => ({
      cellId: cell.cellId,
      runId: cell.runId,
      matrixOccurrenceIndex: cell.matrixOccurrenceIndex,
      scenarioId: cell.scenarioId,
      skillId: cell.skillId,
      modelId: cell.modelId,
      providerId: cell.providerId,
      executionMode: cell.executionMode,
      thinkingLevel: cell.thinkingLevel ?? null,
      thinkingBudget: cell.thinkingBudget ?? null,
      repetitionIndex: cell.repetitionIndex,
      limits: cell.limits,
      temperature: cell.temperature ?? null,
      tags: cell.tags ?? [],
      metadata: cell.metadata ?? {},
    })),
  };
  return createHash("sha256").update(canonicalJson(fingerprintInput)).digest("hex");
}

export async function bindSweepPlan(
  planPath: string,
  lockFileName: string,
  sweepId: string,
  fingerprint: string,
  autoResume: boolean
): Promise<void> {
  const existingBinding = await readBinding(planPath);
  if (existingBinding !== undefined) {
    if (existingBinding.sweepId !== sweepId || existingBinding.fingerprint !== fingerprint) {
      throw new TypeError(incompatibleSweepPlanMessage);
    }
    if (!autoResume) throw new TypeError(occupiedSweepNamespaceMessage);
    return;
  }
  const namespaceEntries = await readdir(dirname(planPath));
  if (namespaceEntries.some((entry) => entry !== lockFileName)) {
    throw new TypeError(occupiedSweepNamespaceMessage);
  }
  const binding: SweepPlanBinding = { version: "1", sweepId, fingerprint };
  await writeFile(planPath, JSON.stringify(binding, null, 2), { encoding: "utf8", flag: "wx" });
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object") return String(value);
  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalValue(child)]);
  return Object.fromEntries(entries);
}

async function readBinding(planPath: string): Promise<SweepPlanBinding | undefined> {
  try {
    const raw = await readFile(planPath, "utf8");
    const value = JSON.parse(raw) as Partial<SweepPlanBinding>;
    if (value.version !== "1" || typeof value.sweepId !== "string" || typeof value.fingerprint !== "string") {
      throw new TypeError(incompatibleSweepPlanMessage);
    }
    return value as SweepPlanBinding;
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    if (error instanceof TypeError && error.message === incompatibleSweepPlanMessage) throw error;
    throw new TypeError(incompatibleSweepPlanMessage);
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

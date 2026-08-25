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
  readonly version: "2";
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
  const binding: SweepPlanBinding = { version: "2", sweepId, fingerprint };
  await writeFile(planPath, JSON.stringify(binding, null, 2), { encoding: "utf8", flag: "wx" });
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, new WeakSet<object>()));
}

function canonicalValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value !== "object") throw new TypeError("Sweep plan contains unsupported configuration data");
  if (ancestors.has(value)) throw new TypeError("Sweep plan contains unsupported configuration data");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return canonicalArray(value, ancestors);
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Sweep plan contains unsupported configuration data");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === "symbol")) {
      throw new TypeError("Sweep plan contains unsupported configuration data");
    }
    const stringKeys = ownKeys as string[];
    const entries = stringKeys.sort(compareUnicodeCodePoints).map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new TypeError("Sweep plan contains unsupported configuration data");
      }
      return [key, canonicalValue(descriptor.value, ancestors)];
    });
    return ["object", entries];
  } finally {
    ancestors.delete(value);
  }
}

function canonicalArray(value: readonly unknown[], ancestors: WeakSet<object>): unknown {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError("Sweep plan contains unsupported configuration data");
  }
  const descriptors = new Map<number, PropertyDescriptor>();
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)) {
      throw new TypeError("Sweep plan contains unsupported configuration data");
    }
    const index = Number(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Number.isSafeInteger(index) || index >= value.length || descriptor === undefined
      || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new TypeError("Sweep plan contains unsupported configuration data");
    }
    descriptors.set(index, descriptor);
  }
  const children = Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors.get(index);
    return descriptor === undefined ? ["array-hole"] : canonicalValue(descriptor.value, ancestors);
  });
  return ["array", children];
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalNumber(value: number): readonly unknown[] {
  if (Number.isNaN(value)) return ["number", "nan"];
  if (value === Number.POSITIVE_INFINITY) return ["number", "positive-infinity"];
  if (value === Number.NEGATIVE_INFINITY) return ["number", "negative-infinity"];
  if (Object.is(value, -0)) return ["number", "negative-zero"];
  return ["number", "finite", value];
}

async function readBinding(planPath: string): Promise<SweepPlanBinding | undefined> {
  try {
    const raw = await readFile(planPath, "utf8");
    const value = JSON.parse(raw) as Partial<SweepPlanBinding>;
    if (value.version !== "2" || typeof value.sweepId !== "string" || typeof value.fingerprint !== "string") {
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

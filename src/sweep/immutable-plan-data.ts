import type { ExecutionLimits, LLMProviderAdapter } from "../runner/types.js";
import type { ModelMatrixEntry } from "./types.js";

export function createImmutableExecutionLimits(limits: ExecutionLimits): ExecutionLimits {
  return Object.freeze({ ...limits });
}

export function createImmutableModelEntry(model: ModelMatrixEntry): ModelMatrixEntry {
  return Object.freeze({
    modelId: model.modelId,
    providerId: model.providerId,
    provider:
      model.provider === undefined ? undefined : createImmutableProviderFacade(model.provider),
    displayName: model.displayName,
    temperature: model.temperature,
    topP: model.topP,
    maxTokens: model.maxTokens,
    thinkingLevel: model.thinkingLevel,
    thinkingBudget: model.thinkingBudget,
    reasoningEffort: model.reasoningEffort,
    concurrencyLimit: model.concurrencyLimit,
    rateLimit: model.rateLimit === undefined ? undefined : Object.freeze({ ...model.rateLimit }),
    tags: model.tags === undefined ? undefined : Object.freeze([...model.tags]),
    metadata:
      model.metadata === undefined
        ? undefined
        : (cloneAndFreezePlanData(model.metadata, new WeakSet<object>()) as Readonly<
            Record<string, unknown>
          >),
  });
}

function createImmutableProviderFacade(provider: LLMProviderAdapter): LLMProviderAdapter {
  return Object.freeze({
    providerId: provider.providerId,
    modelId: provider.modelId,
    executionMode: provider.executionMode,
    simulated: provider.simulated,
    generateStream: provider.generateStream.bind(provider),
    generateTurn: provider.generateTurn.bind(provider),
    calculateCostUSD: provider.calculateCostUSD.bind(provider),
  });
}

function cloneAndFreezePlanData(value: unknown, ancestors: WeakSet<object>): unknown {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  )
    return value;
  if (typeof value !== "object" || ancestors.has(value))
    throw new TypeError("Sweep plan contains unsupported configuration data");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return cloneAndFreezeArray(value, ancestors);
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Sweep plan contains unsupported configuration data");
    }
    const clone = Object.create(prototype) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string")
        throw new TypeError("Sweep plan contains unsupported configuration data");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
        throw new TypeError("Sweep plan contains unsupported configuration data");
      }
      Object.defineProperty(clone, key, {
        value: cloneAndFreezePlanData(descriptor.value, ancestors),
        enumerable: descriptor.enumerable,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(clone);
  } finally {
    ancestors.delete(value);
  }
}

function cloneAndFreezeArray(
  value: readonly unknown[],
  ancestors: WeakSet<object>,
): readonly unknown[] {
  if (Object.getPrototypeOf(value) !== Array.prototype)
    throw new TypeError("Sweep plan contains unsupported configuration data");
  const clone = Array<unknown>(value.length);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)) {
      throw new TypeError("Sweep plan contains unsupported configuration data");
    }
    const index = Number(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !Number.isSafeInteger(index) ||
      index >= value.length ||
      descriptor === undefined ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      throw new TypeError("Sweep plan contains unsupported configuration data");
    }
    clone[index] = cloneAndFreezePlanData(descriptor.value, ancestors);
  }
  return Object.freeze(clone);
}

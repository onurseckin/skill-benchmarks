export function canonicalPlanJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, new WeakSet<object>()));
}

function canonicalValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value !== "object") {
    throw new TypeError("Sweep plan contains unsupported configuration data");
  }
  if (ancestors.has(value))
    throw new TypeError("Sweep plan contains unsupported configuration data");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return canonicalArray(value, ancestors);
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Sweep plan contains unsupported configuration data");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === "symbol")) {
      throw new TypeError("Sweep plan contains unsupported configuration data");
    }
    const entries = (ownKeys as string[]).sort(compareUnicodeCodePoints).map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
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
    if (
      !Number.isSafeInteger(index) ||
      index >= value.length ||
      descriptor === undefined ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
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

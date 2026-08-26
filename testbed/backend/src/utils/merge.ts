export function unsafeRecursiveMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const existing = (target as Record<string, unknown>)[key];
      if (typeof existing !== "object") {
        (target as Record<string, unknown>)[key] = {};
      } else if (existing === null) {
        (target as Record<string, unknown>)[key] = {};
      }
      unsafeRecursiveMerge(
        (target as Record<string, unknown>)[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      (target as Record<string, unknown>)[key] = value;
    }
  }
  return target;
}

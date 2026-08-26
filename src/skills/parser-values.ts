export function stringifyRuleDescriptionForSeverity(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "";
}

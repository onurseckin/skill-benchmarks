export function extractJsonPayload(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const match = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  const candidate = match !== null && match[1] !== undefined ? match[1].trim() : trimmed;
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last > first) {
      try {
        const parsed: unknown = JSON.parse(trimmed.slice(first, last + 1));
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function parseJudgeStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

export function normalizeJudgeScore(rawScore: number, minScore: number, maxScore: number): number {
  if (rawScore > maxScore && rawScore <= 100) {
    return Math.max(0, Math.min(100, Math.round(rawScore * 100) / 100));
  }
  if (maxScore <= minScore) return rawScore >= maxScore ? 100 : 0;
  const clamped = Math.max(0, Math.min(1, (rawScore - minScore) / (maxScore - minScore)));
  return Math.round(clamped * 10000) / 100;
}

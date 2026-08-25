import type {
  CategoryLeaderboard,
  CostEfficiencyPoint,
  LeaderboardEntry,
} from "./types.js";

export type TableAlignment = "left" | "center" | "right";

export interface LeaderboardMetadata {
  readonly totalRuns?: number;
  readonly lastUpdated?: string;
  readonly controlSkillId?: string;
}

export function formatRank(rank: number): string {
  if (rank === 1) {
    return "🥇 1";
  }
  if (rank === 2) {
    return "🥈 2";
  }
  if (rank === 3) {
    return "🥉 3";
  }
  return `${rank}`;
}

export function formatScore(score: number): string {
  return `${score.toFixed(1)} / 100`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  return `${minutes}m ${remainingSecs.toFixed(1)}s`;
}

export function formatCost(cost: number | undefined): string {
  if (cost === undefined) return "UNVERIFIED";
  if (cost === 0) {
    return "$0.000";
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(3)}`;
}

function formatCostDifference(cost: number | undefined): string {
  if (cost === undefined) return "UNVERIFIED";
  return `${cost >= 0 ? "+" : ""}${formatCost(cost)}`;
}

export function formatCacheHitRatio(ratio: number): string {
  const percentage = ratio <= 1 ? ratio * 100 : ratio;
  return `${percentage.toFixed(1)}%`;
}

export function formatCategoryName(category: string): string {
  if (!category) {
    return "General";
  }
  return category
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatPassRate(entry: LeaderboardEntry): string {
  const base = `${entry.passRate.toFixed(1)}%`;
  const formattedBase = entry.rank === 1 ? `**${base}**` : base;
  if (entry.passRateDeltaOverControl === undefined) {
    return formattedBase;
  }
  const delta = entry.passRateDeltaOverControl;
  let deltaStr = "";
  if (Math.abs(delta) < 0.01) {
    deltaStr = "(Ref)";
  } else if (delta > 0) {
    deltaStr = `(+${delta.toFixed(1)}%)`;
  } else {
    deltaStr = `(${delta.toFixed(1)}%)`;
  }
  const sigMarker = entry.isStatisticallySignificant ? "*" : "";
  return `${formattedBase} ${deltaStr}${sigMarker}`;
}

export function formatElo(elo: number, rank: number): string {
  const rounded = Math.round(elo);
  return rank === 1 ? `**${rounded}**` : `${rounded}`;
}

export function generateMarkdownTable(
  headers: readonly string[],
  alignments: readonly TableAlignment[],
  rows: ReadonlyArray<readonly string[]>
): string {
  if (headers.length === 0) {
    return "";
  }
  const alignmentRow = alignments.map((align) => {
    if (align === "center") {
      return ":---:";
    }
    if (align === "right") {
      return "---:";
    }
    return ":---";
  });
  const lines: string[] = [
    `| ${headers.join(" | ")} |`,
    `| ${alignmentRow.join(" | ")} |`,
  ];
  for (const row of rows) {
    lines.push(`| ${row.join(" | ")} |`);
  }
  return lines.join("\n");
}

export function generateSummaryTableMarkdown(entries: readonly LeaderboardEntry[]): string {
  if (entries.length === 0) {
    return "_No benchmark runs recorded._";
  }
  const headers = [
    "Rank",
    "Skill",
    "Category",
    "Pass Rate",
    "Elo Rating",
    "Avg Score",
    "Mean Duration",
    "Avg Cost",
    "Cache Hit",
    "Runs",
  ];
  const alignments: readonly TableAlignment[] = [
    "center",
    "left",
    "left",
    "center",
    "center",
    "center",
    "center",
    "center",
    "center",
    "center",
  ];
  const rows: string[][] = [];
  for (const entry of entries) {
    rows.push([
      formatRank(entry.rank),
      `\`${entry.skillId}\``,
      formatCategoryName(entry.category),
      formatPassRate(entry),
      formatElo(entry.eloRating, entry.rank),
      formatScore(entry.averageScore),
      formatDuration(entry.meanDurationSeconds),
      formatCost(entry.averageCostUSD),
      formatCacheHitRatio(entry.cacheHitRatio),
      `${entry.totalRuns}`,
    ]);
  }
  return generateMarkdownTable(headers, alignments, rows);
}

export function generateCategoryMarkdown(category: CategoryLeaderboard): string {
  const title = formatCategoryName(category.category);
  const lines: string[] = [
    `### Category: ${title}`,
    "",
    `_Top Skill: \`${category.topSkillId || "None"}\` | Total Runs: ${category.totalRuns} | Updated: ${category.updatedAt}_`,
    "",
  ];
  if (category.entries.length === 0) {
    lines.push("_No runs recorded for this category._");
    return lines.join("\n");
  }
  const headers = [
    "Rank",
    "Skill",
    "Pass Rate",
    "Elo Rating",
    "Avg Score",
    "Mean Duration",
    "Avg Cost",
    "Cache Hit",
    "Runs",
  ];
  const alignments: readonly TableAlignment[] = [
    "center",
    "left",
    "center",
    "center",
    "center",
    "center",
    "center",
    "center",
    "center",
  ];
  const rows: string[][] = [];
  for (const entry of category.entries) {
    rows.push([
      formatRank(entry.rank),
      `\`${entry.skillId}\``,
      formatPassRate(entry),
      formatElo(entry.eloRating, entry.rank),
      formatScore(entry.averageScore),
      formatDuration(entry.meanDurationSeconds),
      formatCost(entry.averageCostUSD),
      formatCacheHitRatio(entry.cacheHitRatio),
      `${entry.totalRuns}`,
    ]);
  }
  lines.push(generateMarkdownTable(headers, alignments, rows));
  return lines.join("\n");
}

export function generateCostEfficiencyTable(points: readonly CostEfficiencyPoint[]): string {
  if (points.length === 0) {
    return "_No cost efficiency data available._";
  }
  const headers = [
    "Skill",
    "Model",
    "Pass Rate",
    "Avg Score",
    "Avg Cost",
    "Tokens / Task",
    "Latency",
  ];
  const alignments: readonly TableAlignment[] = [
    "left",
    "left",
    "center",
    "center",
    "center",
    "center",
    "center",
  ];
  const rows: string[][] = [];
  for (const point of points) {
    const tokens = point.tokensPerTask > 0 ? Math.round(point.tokensPerTask).toLocaleString() : "N/A";
    const durationSeconds = point.durationMs / 1000;
    rows.push([
      `\`${point.skillId}\``,
      `\`${point.modelId}\``,
      `${point.passRate.toFixed(1)}%`,
      formatScore(point.compositeScore),
      formatCost(point.averageCostUSD),
      tokens,
      formatDuration(durationSeconds),
    ]);
  }
  return generateMarkdownTable(headers, alignments, rows);
}

export function generateComparisonTable(
  skillA: LeaderboardEntry,
  skillB: LeaderboardEntry
): string {
  const headers = [
    "Metric",
    `\`${skillA.skillId}\` (A)`,
    `\`${skillB.skillId}\` (B)`,
    "Difference (A - B)",
  ];
  const alignments: readonly TableAlignment[] = ["left", "center", "center", "center"];
  const passRateDiff = skillA.passRate - skillB.passRate;
  const eloDiff = skillA.eloRating - skillB.eloRating;
  const scoreDiff = skillA.averageScore - skillB.averageScore;
  const durationDiff = skillA.meanDurationSeconds - skillB.meanDurationSeconds;
  const costDiff = skillA.averageCostUSD === undefined || skillB.averageCostUSD === undefined
    ? undefined
    : skillA.averageCostUSD - skillB.averageCostUSD;
  const rawCacheA = skillA.cacheHitRatio <= 1 ? skillA.cacheHitRatio * 100 : skillA.cacheHitRatio;
  const rawCacheB = skillB.cacheHitRatio <= 1 ? skillB.cacheHitRatio * 100 : skillB.cacheHitRatio;
  const cacheDiff = rawCacheA - rawCacheB;
  const rankDiff = skillB.rank - skillA.rank;

  const rows: ReadonlyArray<readonly string[]> = [
    ["Rank", `${skillA.rank}`, `${skillB.rank}`, `${rankDiff > 0 ? "+" : ""}${rankDiff}`],
    ["Pass Rate", `${skillA.passRate.toFixed(1)}%`, `${skillB.passRate.toFixed(1)}%`, `${passRateDiff >= 0 ? "+" : ""}${passRateDiff.toFixed(1)}%`],
    ["Elo Rating", `${Math.round(skillA.eloRating)}`, `${Math.round(skillB.eloRating)}`, `${eloDiff >= 0 ? "+" : ""}${Math.round(eloDiff)}`],
    ["Average Score", formatScore(skillA.averageScore), formatScore(skillB.averageScore), `${scoreDiff >= 0 ? "+" : ""}${scoreDiff.toFixed(1)}`],
    ["Mean Duration", formatDuration(skillA.meanDurationSeconds), formatDuration(skillB.meanDurationSeconds), `${durationDiff >= 0 ? "+" : ""}${durationDiff.toFixed(1)}s`],
    ["Average Cost", formatCost(skillA.averageCostUSD), formatCost(skillB.averageCostUSD), formatCostDifference(costDiff)],
    ["Cache Hit Ratio", formatCacheHitRatio(skillA.cacheHitRatio), formatCacheHitRatio(skillB.cacheHitRatio), `${cacheDiff >= 0 ? "+" : ""}${cacheDiff.toFixed(1)}%`],
    ["Total Runs", `${skillA.totalRuns}`, `${skillB.totalRuns}`, `${skillA.totalRuns - skillB.totalRuns >= 0 ? "+" : ""}${skillA.totalRuns - skillB.totalRuns}`],
  ];

  return generateMarkdownTable(headers, alignments, rows);
}

export function generateSkillDetailMarkdown(
  entry: LeaderboardEntry,
  costPoints?: readonly CostEfficiencyPoint[]
): string {
  const lines: string[] = [
    `### Skill: \`${entry.skillId}\``,
    "",
    `- **Category:** ${formatCategoryName(entry.category)}`,
    `- **Rank:** ${formatRank(entry.rank)}`,
    `- **Pass Rate:** ${formatPassRate(entry)}`,
    `- **Elo Rating:** ${Math.round(entry.eloRating)}`,
    `- **Average Composite Score:** ${formatScore(entry.averageScore)}`,
    `- **Mean Duration:** ${formatDuration(entry.meanDurationSeconds)}`,
    `- **Average Cost:** ${formatCost(entry.averageCostUSD)}`,
    `- **Cache Hit Ratio:** ${formatCacheHitRatio(entry.cacheHitRatio)}`,
    `- **Evaluated Runs:** ${entry.totalRuns}`,
    `- **Statistically Significant:** ${entry.isStatisticallySignificant ? "Yes (p < 0.05)" : "No"}`,
  ];

  const skillPoints = costPoints?.filter((p) => p.skillId === entry.skillId);
  if (skillPoints && skillPoints.length > 0) {
    lines.push("");
    lines.push("#### Model Cost Efficiency Breakdown");
    lines.push("");
    lines.push(generateCostEfficiencyTable(skillPoints));
  }

  return lines.join("\n");
}

export function generateMarkdownLeaderboard(
  entries: readonly LeaderboardEntry[],
  categoryLeaderboards?: readonly CategoryLeaderboard[],
  metadata?: { readonly totalRuns?: number; readonly lastUpdated?: string; readonly controlSkillId?: string }
): string {
  const lastUpdated = metadata?.lastUpdated ?? new Date().toISOString();
  const totalRuns = metadata?.totalRuns ?? entries.reduce((sum, e) => sum + e.totalRuns, 0);
  const controlPart = metadata?.controlSkillId ? ` | Control Baseline: \`${metadata.controlSkillId}\`` : "";

  const lines: string[] = [
    "# 🏆 Agent Skill Benchmark Leaderboard",
    "",
    `_Last Updated: ${lastUpdated} | Total Evaluated Runs: ${totalRuns}${controlPart}_`,
    "",
    "## 📊 Overall Skill Leaderboard",
    "",
    generateSummaryTableMarkdown(entries),
  ];

  const hasSignificantEntries = entries.some((e) => e.isStatisticallySignificant);
  if (hasSignificantEntries || metadata?.controlSkillId) {
    lines.push("");
    lines.push("---");
    lines.push("_\\* Statistically significant improvement over baseline control (p < 0.05)._");
  }

  if (categoryLeaderboards && categoryLeaderboards.length > 0) {
    lines.push("");
    lines.push("## 🏷️ Category Leaderboards");
    for (const category of categoryLeaderboards) {
      lines.push("");
      lines.push(generateCategoryMarkdown(category));
    }
  }

  return lines.join("\n");
}

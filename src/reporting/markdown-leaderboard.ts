import type { ReportLeaderboardEntry, ReportSnapshot } from "./report-cohorts.js";

export function generateMarkdownLeaderboard(snapshot: ReportSnapshot): string {
  const lines = [
    "# Benchmark Evidence Report",
    "",
    `Generated: ${snapshot.generatedAt}`,
    `Matched records: ${snapshot.matchedRunCount}`,
    `Eligible benchmark records: ${snapshot.eligibleRunCount}`,
    `Diagnostic records: ${snapshot.diagnosticRunCount}`,
    ...(snapshot.provenance.evidenceThrough === undefined ? [] : [`Evidence through: ${escapeMarkdownInline(snapshot.provenance.evidenceThrough)}`]),
    "",
    "## Evidence provenance",
    "",
    `Execution modes: live ${snapshot.provenance.executionModeCounts.live}, fake ${snapshot.provenance.executionModeCounts.fake}`,
    `Simulation: simulated ${snapshot.provenance.simulatedRunCount}, non-simulated ${snapshot.provenance.nonSimulatedRunCount}`,
    `Cohorts: eligible ${snapshot.provenance.cohortCounts.eligible}, validation ${snapshot.provenance.cohortCounts.validation}, operational ${snapshot.provenance.cohortCounts.operational}`,
    `Evaluation: evaluated ${snapshot.provenance.evaluationStatusCounts.evaluated}, UNEVALUATED ${snapshot.provenance.evaluationStatusCounts.not_evaluated + snapshot.provenance.evaluationStatusCounts.not_requested}, invalid ${snapshot.provenance.evaluationStatusCounts.invalid}`,
  ];
  if (snapshot.provenance.simulatedRunCount > 0) lines.push("SIMULATED executions are diagnostic and unranked.");
  if (snapshot.provenance.eligibilityReasonCounts.length > 0) {
    lines.push("", "Eligibility reasons:");
    for (const item of snapshot.provenance.eligibilityReasonCounts) lines.push(`- ${item.reason}: ${item.count}`);
  }
  if (snapshot.eligibleRunCount === 0) {
    lines.push("", "## NO ELIGIBLE BENCHMARK EVIDENCE", "", "No ranking, score, pass-rate, trend, or cost claim is available for this cohort.");
    return lines.join("\n");
  }
  lines.push("", "## Eligible leaderboard", "", renderLeaderboard(snapshot.leaderboard));
  if (snapshot.trends !== undefined && snapshot.trends.length > 0) {
    lines.push("", "## Eligible trends", "", "| Date | Samples | Passed | Pass rate | Mean score |", "| :--- | ---: | ---: | ---: | ---: |");
    for (const trend of snapshot.trends) {
      lines.push(`| ${escapeMarkdownInline(trend.date)} | ${trend.eligibleRunCount} | ${trend.passCount} | ${formatPercent(trend.passRate)} | ${trend.score.mean.toFixed(2)} |`);
    }
  }
  if (snapshot.costEfficiency !== undefined && snapshot.costEfficiency.length > 0) {
    lines.push("", "## Verified actual-cost observations", "", "| Category | Skill | Model | Samples | Mean actual cost | Mean score | Pass rate |", "| :--- | :--- | :--- | ---: | ---: | ---: | ---: |");
    for (const point of snapshot.costEfficiency) {
      lines.push(`| ${escapeMarkdownInline(point.category)} | ${escapeMarkdownInline(point.skillId)} | ${escapeMarkdownInline(point.modelId)} | ${point.sampleCount} | $${point.averageVerifiedActualCostUSD.toFixed(4)} | ${point.averageScore.toFixed(2)} | ${formatPercent(point.passRate)} |`);
    }
  }
  return lines.join("\n");
}

function renderLeaderboard(entries: readonly ReportLeaderboardEntry[]): string {
  const lines = [
    "| Rank | Category | Skill | Scenarios | Models | Providers | Samples | Passed | Failed | Pass rate | Pass interval | Mean score | Score samples | Mean duration |",
    "| ---: | :--- | :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | :--- | ---: | ---: | ---: |",
  ];
  for (const entry of entries) {
    lines.push(`| ${entry.rank} | ${escapeMarkdownInline(entry.category)} | ${escapeMarkdownInline(entry.skillId)} | ${escapeMarkdownInline(entry.scenarioIds.join(", "))} | ${escapeMarkdownInline(entry.modelIds.join(", "))} | ${escapeMarkdownInline(entry.providerIds.join(", "))} | ${entry.eligibleRunCount} | ${entry.passCount} | ${entry.failedBenchmarkCount} | ${formatPercent(entry.passRate)} | ${entry.passRateConfidence95[0].toFixed(1)}–${entry.passRateConfidence95[1].toFixed(1)}% | ${entry.score.mean.toFixed(2)} | ${entry.score.sampleCount} | ${(entry.duration.mean / 1000).toFixed(2)}s |`);
  }
  return lines.join("\n");
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function escapeMarkdownInline(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
}

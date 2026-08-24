import type {
  ApcaBadgeStyle,
  GitHubCommentClientConfig,
  MetricDiffCard,
  PrCommentPayload,
  PrLeaderboardCommentOptions,
  RegressionStatus,
  RegressionSummary,
  ScenarioRegressionDelta,
  SkillRegressionDelta,
} from "./types.js";
import { formatPValue } from "./regression-detector.js";

export const PR_LEADERBOARD_MARKER = "<!-- skill-benchmarks-pr-leaderboard -->";

export function formatApcaBadge(badge: ApcaBadgeStyle): string {
  return `<span style="background-color: ${badge.backgroundColor}; color: ${badge.textColor}; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 11px;">${badge.icon ? `${badge.icon} ` : ""}${badge.label}: ${badge.value}</span>`;
}

export function getStatusBadge(status: RegressionStatus): ApcaBadgeStyle {
  switch (status) {
    case "improved":
      return { label: "STATUS", value: "IMPROVED", backgroundColor: "#238636", textColor: "#ffffff", contrastRatio: 4.8, accessible: true, icon: "▲" };
    case "critical_regression":
      return { label: "STATUS", value: "CRITICAL REGRESSION", backgroundColor: "#da3633", textColor: "#ffffff", contrastRatio: 4.9, accessible: true, icon: "▼" };
    case "regressed":
      return { label: "STATUS", value: "REGRESSED", backgroundColor: "#d29922", textColor: "#000000", contrastRatio: 8.2, accessible: true, icon: "▼" };
    case "neutral":
    default:
      return { label: "STATUS", value: "NEUTRAL", backgroundColor: "#6e7681", textColor: "#ffffff", contrastRatio: 4.5, accessible: true, icon: "●" };
  }
}

export function getVerdictBadge(verdict: "PASS" | "FAIL" | "WARNING"): ApcaBadgeStyle {
  switch (verdict) {
    case "PASS":
      return { label: "BENCHMARK GATE", value: "PASSED", backgroundColor: "#238636", textColor: "#ffffff", contrastRatio: 4.8, accessible: true, icon: "✅" };
    case "FAIL":
      return { label: "BENCHMARK GATE", value: "FAILED", backgroundColor: "#da3633", textColor: "#ffffff", contrastRatio: 4.9, accessible: true, icon: "❌" };
    case "WARNING":
    default:
      return { label: "BENCHMARK GATE", value: "WARNING", backgroundColor: "#d29922", textColor: "#000000", contrastRatio: 8.2, accessible: true, icon: "⚠️" };
  }
}

export function buildMetricCards(summary: RegressionSummary): readonly MetricDiffCard[] {
  const cards: MetricDiffCard[] = [];
  const scoreDeltaFormatted = `${summary.overallScoreDelta >= 0 ? "+" : ""}${summary.overallScoreDelta.toFixed(1)} pts`;
  cards.push({
    title: "Composite Score Delta",
    baselineFormatted: "Baseline",
    candidateFormatted: "PR Candidate",
    deltaFormatted: scoreDeltaFormatted,
    deltaType: summary.overallScoreDelta > 0 ? "positive" : summary.overallScoreDelta < 0 ? "negative" : "neutral",
  });

  const passRateFormatted = `${summary.overallPassRateDelta >= 0 ? "+" : ""}${summary.overallPassRateDelta.toFixed(1)}%`;
  cards.push({
    title: "Pass Rate Delta",
    baselineFormatted: "Baseline",
    candidateFormatted: "PR Candidate",
    deltaFormatted: passRateFormatted,
    deltaType: summary.overallPassRateDelta > 0 ? "positive" : summary.overallPassRateDelta < 0 ? "negative" : "neutral",
  });

  const eloFormatted = `${summary.overallEloDrift >= 0 ? "+" : ""}${summary.overallEloDrift.toFixed(0)} pts`;
  cards.push({
    title: "Average Elo Drift",
    baselineFormatted: "Baseline",
    candidateFormatted: "PR Candidate",
    deltaFormatted: eloFormatted,
    deltaType: summary.overallEloDrift > 0 ? "positive" : summary.overallEloDrift < 0 ? "negative" : "neutral",
  });

  return cards;
}

export function formatSkillDeltaRow(delta: SkillRegressionDelta, rank: number): string {
  const scoreSign = delta.scoreDelta >= 0 ? "+" : "";
  const passSign = delta.passRateDelta >= 0 ? "+" : "";
  const eloSign = delta.eloDelta >= 0 ? "+" : "";
  const sigMarker = delta.isStatisticallySignificant ? "*" : "";
  const badge = formatApcaBadge(getStatusBadge(delta.status));
  const pValueStr = delta.pValue !== undefined ? formatPValue(delta.pValue) : "-";

  return `| ${rank} | **${delta.skillId}** | ${delta.category} | ${delta.baselineScore.toFixed(1)} | ${delta.candidateScore.toFixed(1)} | ${scoreSign}${delta.scoreDelta.toFixed(1)}${sigMarker} | ${passSign}${delta.passRateDelta.toFixed(1)}% | ${eloSign}${delta.eloDelta.toFixed(0)} | ${pValueStr} | ${badge} |`;
}

export function formatScenarioDeltaRow(delta: ScenarioRegressionDelta): string {
  const passSign = delta.passRateDelta >= 0 ? "+" : "";
  const scoreSign = delta.scoreDelta >= 0 ? "+" : "";
  const badge = formatApcaBadge(getStatusBadge(delta.status));
  return `| **${delta.scenarioId}** | ${delta.baselinePassRate.toFixed(1)}% | ${delta.candidatePassRate.toFixed(1)}% | ${passSign}${delta.passRateDelta.toFixed(1)}% | ${scoreSign}${delta.scoreDelta.toFixed(1)} | ${badge} |`;
}

export function generatePrLeaderboardMarkdown(
  summary: RegressionSummary,
  options: PrLeaderboardCommentOptions
): string {
  const marker = options.commentTagMarker ?? PR_LEADERBOARD_MARKER;
  const verdictBadge = formatApcaBadge(getVerdictBadge(summary.verdict));
  const lines: string[] = [];

  lines.push(marker);
  lines.push(`## 📊 Automated Skill Benchmark & PR Leaderboard`);
  lines.push("");
  lines.push(`${verdictBadge} **Evaluation for Commit:** \`${options.commitSha.slice(0, 7)}\` | **Evaluated At:** \`${summary.evaluatedAt}\``);
  lines.push("");

  lines.push(`### 🎯 Regression Overview`);
  lines.push("");
  lines.push(`| Metric | Value | Status |`);
  lines.push(`| :--- | :--- | :--- |`);
  lines.push(`| **Gate Verdict** | **${summary.verdict}** | ${summary.verdict === "PASS" ? "✅ Passed" : summary.verdict === "FAIL" ? "❌ Failed" : "⚠️ Warning"} |`);
  lines.push(`| **Overall Score Delta** | ${summary.overallScoreDelta >= 0 ? "+" : ""}${summary.overallScoreDelta.toFixed(2)} pts | ${summary.overallScoreDelta >= 0 ? "▲ Improved/Steady" : "▼ Dropped"} |`);
  lines.push(`| **Pass Rate Delta** | ${summary.overallPassRateDelta >= 0 ? "+" : ""}${summary.overallPassRateDelta.toFixed(2)}% | ${summary.overallPassRateDelta >= 0 ? "▲ Improved/Steady" : "▼ Dropped"} |`);
  lines.push(`| **Overall Elo Drift** | ${summary.overallEloDrift >= 0 ? "+" : ""}${summary.overallEloDrift.toFixed(1)} pts | ${summary.overallEloDrift >= 0 ? "▲ Positive" : "▼ Negative"} |`);
  lines.push(`| **Skills Evaluated** | ${summary.totalSkillsEvaluated} total (${summary.improvedSkillsCount} improved, ${summary.regressedSkillsCount} regressed, ${summary.criticalRegressionsCount} critical) | ${summary.criticalRegressionsCount === 0 ? "✅ No critical regression" : "❌ Critical regressions"} |`);
  lines.push("");

  if (summary.criticalFindings.length > 0) {
    lines.push(`### ⚠️ Critical Findings`);
    lines.push("");
    for (const finding of summary.criticalFindings) {
      lines.push(`- 🔴 ${finding}`);
    }
    lines.push("");
  }

  if (summary.recommendations.length > 0) {
    lines.push(`### 💡 Recommendations`);
    lines.push("");
    for (const rec of summary.recommendations) {
      lines.push(`- 📌 ${rec}`);
    }
    lines.push("");
  }

  lines.push(`### 🏆 Skill Leaderboard Deltas`);
  lines.push("");
  lines.push(`| Rank | Skill | Category | Base Score | PR Score | Score Δ | Pass Δ | Elo Δ | p-value | Status |`);
  lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);

  const maxSkills = options.maxSkillsToShow ?? 25;
  const sortedSkills = [...summary.skillDeltas].sort((a, b) => b.candidateScore - a.candidateScore);
  const skillsToDisplay = sortedSkills.slice(0, maxSkills);

  skillsToDisplay.forEach((delta, index) => {
    lines.push(formatSkillDeltaRow(delta, index + 1));
  });
  lines.push("");
  lines.push(`*\\* Indicates statistical significance at alpha = 0.05 (Welch's t-test).*`);
  lines.push("");

  if (options.includeScenarioBreakdown && summary.scenarioDeltas.length > 0) {
    lines.push(`### 🧪 Scenario Breakdown`);
    lines.push("");
    lines.push(`| Scenario | Base Pass % | PR Pass % | Pass Rate Δ | Score Δ | Status |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);
    for (const delta of summary.scenarioDeltas) {
      lines.push(formatScenarioDeltaRow(delta));
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(`*Generated by [skill-benchmarks](https://github.com/${options.repoOwner ?? "org"}/${options.repoName ?? "repo"}) PR Leaderboard Bot.*`);

  return lines.join("\n");
}

export class GitHubCommentClient {
  public readonly config: GitHubCommentClientConfig;
  public readonly apiBaseUrl: string;

  constructor(config: GitHubCommentClientConfig) {
    this.config = config;
    this.apiBaseUrl = config.apiBaseUrl ?? "https://api.github.com";
  }

  public async findExistingBotComment(marker: string = PR_LEADERBOARD_MARKER): Promise<number | null> {
    const url = `${this.apiBaseUrl}/repos/${this.config.owner}/${this.config.repo}/issues/${this.config.prNumber}/comments`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "skill-benchmarks-pr-bot",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) return null;
    const comments = (await response.json()) as Array<{ readonly id: number; readonly body?: string }>;
    for (const comment of comments) {
      if (comment.body && comment.body.includes(marker)) {
        return comment.id;
      }
    }
    return null;
  }

  public async postOrUpdateComment(markdownBody: string, marker: string = PR_LEADERBOARD_MARKER): Promise<PrCommentPayload> {
    const existingCommentId = await this.findExistingBotComment(marker);
    if (existingCommentId !== null) {
      const url = `${this.apiBaseUrl}/repos/${this.config.owner}/${this.config.repo}/issues/comments/${existingCommentId}`;
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "skill-benchmarks-pr-bot",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ body: markdownBody }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update GitHub PR comment: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { readonly id: number; readonly html_url?: string };
      return {
        body: markdownBody,
        commentId: data.id,
        isNewComment: false,
        postedAt: new Date().toISOString(),
        htmlUrl: data.html_url,
      };
    }

    const postUrl = `${this.apiBaseUrl}/repos/${this.config.owner}/${this.config.repo}/issues/${this.config.prNumber}/comments`;
    const response = await fetch(postUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "skill-benchmarks-pr-bot",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ body: markdownBody }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create GitHub PR comment: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { readonly id: number; readonly html_url?: string };
    return {
      body: markdownBody,
      commentId: data.id,
      isNewComment: true,
      postedAt: new Date().toISOString(),
      htmlUrl: data.html_url,
    };
  }
}

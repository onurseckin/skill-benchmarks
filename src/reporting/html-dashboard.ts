import { createContentSecurityPolicyMeta } from "../shared/html-content-security.js";
import { escapeHtmlAttribute, escapeHtmlText, serializeEmbeddedJson } from "../shared/html-escape.js";
import {
  renderCostObservations,
  renderLatencyObservations,
  renderTrendObservations,
  renderVelocityObservations,
} from "./dashboard-charts.js";
import { dashboardScript } from "./dashboard-script.js";
import { dashboardStyle } from "./dashboard-style.js";
import type { ReportFilter, ReportLeaderboardEntry, ReportSnapshot } from "./report-cohorts.js";

export interface DashboardMetadata {
  readonly title?: string;
}

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const timestamp = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "long",
  timeZone: "UTC",
});
const policyMarker = "<meta data-content-security-policy>";

export function generateHtmlDashboard(snapshot: ReportSnapshot, metadata: DashboardMetadata = {}): string {
  const title = escapeHtmlText(metadata.title ?? "Benchmark Evidence Dashboard");
  const hasEligibleEvidence = snapshot.eligibleRunCount > 0;
  const optionalClaims = hasEligibleEvidence ? renderOptionalClaims(snapshot) : "";
  const content = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#090b10">
<meta name="color-scheme" content="dark">
${policyMarker}
<title>${title}</title>
<style>${dashboardStyle()}</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to report evidence</a>
<main id="main-content">
<header><p class="eyebrow">PERSISTED BENCHMARK EVIDENCE</p><h1>${title}</h1>${renderTime("Generated", snapshot.generatedAt)}${renderEvidenceThrough(snapshot)}${renderActiveFilters(snapshot.filter)}</header>
${renderCounts(snapshot)}
${renderProvenance(snapshot)}
${hasEligibleEvidence ? renderLeaderboard(snapshot.leaderboard) : renderUnavailable(snapshot)}
${optionalClaims}
</main>
${hasEligibleEvidence ? `<script>${dashboardScript}</script>` : ""}
</body>
</html>`;
  return content.replace(policyMarker, createContentSecurityPolicyMeta(content));
}

function renderCounts(snapshot: ReportSnapshot): string {
  return `<section class="facts" aria-label="Report cohort counts"><article class="fact"><span>MATCHED RECORDS</span><strong>${integer.format(snapshot.matchedRunCount)}</strong></article><article class="fact"><span>ELIGIBLE RECORDS</span><strong>${integer.format(snapshot.eligibleRunCount)}</strong></article><article class="fact"><span>DIAGNOSTIC RECORDS</span><strong>${integer.format(snapshot.diagnosticRunCount)}</strong></article></section>`;
}

function renderProvenance(snapshot: ReportSnapshot): string {
  const value = snapshot.provenance;
  const reasons = value.eligibilityReasonCounts.length === 0
    ? ""
    : `<h3>Observed ineligibility reasons</h3><ul>${value.eligibilityReasonCounts.map((entry) => `<li>${escapeHtmlText(entry.reason)}: ${integer.format(entry.count)}</li>`).join("")}</ul>`;
  return `<section class="panel" aria-labelledby="provenance-heading"><h2 id="provenance-heading">EVIDENCE PROVENANCE</h2><dl><div><dt>LIVE</dt><dd>${integer.format(value.executionModeCounts.live)}</dd></div><div><dt>FAKE</dt><dd>${integer.format(value.executionModeCounts.fake)}</dd></div><div><dt>SIMULATED</dt><dd>${integer.format(value.simulatedRunCount)}</dd></div><div><dt>NON-SIMULATED</dt><dd>${integer.format(value.nonSimulatedRunCount)}</dd></div><div><dt>EVALUATED</dt><dd>${integer.format(value.evaluationStatusCounts.evaluated)}</dd></div><div><dt>NOT EVALUATED</dt><dd>${integer.format(value.evaluationStatusCounts.not_evaluated + value.evaluationStatusCounts.not_requested)}</dd></div></dl>${reasons}</section>`;
}

function renderUnavailable(snapshot: ReportSnapshot): string {
  const simulated = snapshot.provenance.simulatedRunCount > 0 ? "SIMULATED / UNRANKED. " : "";
  return `<section class="unavailable" aria-labelledby="unavailable-heading"><h2 id="unavailable-heading">NO ELIGIBLE BENCHMARK EVIDENCE</h2><p>${simulated}Unevaluated or ineligible records remain diagnostic provenance. No ranking, score, pass-rate, trend, cost, latency, or velocity claim is available.</p></section>`;
}

function renderLeaderboard(entries: readonly ReportLeaderboardEntry[]): string {
  const rows = entries.map(renderLeaderboardRow).join("");
  const categories = unique(entries.map((entry) => entry.category));
  const skills = unique(entries.map((entry) => entry.skillId));
  const models = unique(entries.flatMap((entry) => entry.modelIds));
  const providers = unique(entries.flatMap((entry) => entry.providerIds));
  return `<section class="panel" aria-labelledby="leaderboard-heading"><h2 id="leaderboard-heading">ELIGIBLE BENCHMARK COHORTS</h2><form class="filters"><div class="field"><label for="report-search">Search eligible evidence</label><input id="report-search" name="search" type="search" autocomplete="off" placeholder="Search skills…"></div>${renderSelect("category", "Category", categories)}${renderSelect("skill", "Skill", skills)}${renderSelect("model", "Model", models)}${renderSelect("provider", "Provider", providers)}</form><p class="result-count" id="result-count" aria-live="polite"></p><p class="empty-filter" id="filter-empty" data-visible="false">No eligible cohort matches the current local filters.</p><div class="table-wrap"><table data-leaderboard><caption>Eligible benchmark evidence only; every row includes its observed sample count.</caption><thead><tr>${renderSortableHeading("rank", "RANK", true)}<th scope="col">CATEGORY</th><th scope="col">SKILL</th><th scope="col">SCENARIOS</th><th scope="col">MODELS</th><th scope="col">PROVIDERS</th>${renderSortableHeading("samples", "SAMPLES")}${renderSortableHeading("passed", "PASSED")}<th scope="col">FAILED</th>${renderSortableHeading("passRate", "PASS RATE")}${renderSortableHeading("score", "MEAN SCORE")}<th scope="col">MEAN DURATION</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function renderLeaderboardRow(entry: ReportLeaderboardEntry): string {
  const attributes = [
    `data-rank="${entry.rank}"`,
    `data-category="${escapeHtmlAttribute(entry.category)}"`,
    `data-skill="${escapeHtmlAttribute(entry.skillId)}"`,
    `data-model-values="${escapeHtmlAttribute(serializeEmbeddedJson(entry.modelIds))}"`,
    `data-provider-values="${escapeHtmlAttribute(serializeEmbeddedJson(entry.providerIds))}"`,
    `data-samples="${entry.eligibleRunCount}"`,
    `data-passed="${entry.passCount}"`,
    `data-pass-rate="${entry.passRate}"`,
    `data-score="${entry.score.mean}"`,
  ].join(" ");
  return `<tr ${attributes}><td>${integer.format(entry.rank)}</td><td>${escapeHtmlText(entry.category)}</td><th scope="row">${escapeHtmlText(entry.skillId)}</th><td>${escapeHtmlText(entry.scenarioIds.join(", "))}</td><td>${escapeHtmlText(entry.modelIds.join(", "))}</td><td>${escapeHtmlText(entry.providerIds.join(", "))}</td><td>${integer.format(entry.eligibleRunCount)}</td><td>${integer.format(entry.passCount)}</td><td>${integer.format(entry.failedBenchmarkCount)}</td><td>${percent.format(entry.passRate / 100)}</td><td>${decimal.format(entry.score.mean)}</td><td>${decimal.format(entry.duration.mean / 1000)} s</td></tr>`;
}

function renderSortableHeading(key: string, label: string, active = false): string {
  return `<th scope="col" aria-sort="${active ? "ascending" : "none"}"><button class="sort-button" type="button" data-sort="${key}">${label}</button></th>`;
}

function renderSelect(key: string, label: string, values: readonly string[]): string {
  const options = values.map((value) => `<option value="${escapeHtmlAttribute(value)}">${escapeHtmlText(value)}</option>`).join("");
  return `<div class="field"><label for="filter-${key}">${label}</label><select id="filter-${key}" name="${key}" autocomplete="off" data-filter="${key}"><option value="">All observed</option>${options}</select></div>`;
}

function renderOptionalClaims(snapshot: ReportSnapshot): string {
  const latency = snapshot.latencyPercentiles === undefined ? "" : renderLatencyObservations(snapshot.latencyPercentiles);
  const trends = snapshot.trends === undefined || snapshot.trends.length === 0 ? "" : renderTrendObservations(snapshot.trends);
  const velocity = snapshot.tokenVelocity === undefined || snapshot.tokenVelocity.length === 0 ? "" : renderVelocityObservations(snapshot.tokenVelocity);
  const costs = snapshot.costEfficiency === undefined || snapshot.costEfficiency.length === 0 ? "" : renderCostObservations(snapshot.costEfficiency);
  return `${trends}${costs}${latency}${velocity}`;
}

function renderEvidenceThrough(snapshot: ReportSnapshot): string {
  return snapshot.provenance.evidenceThrough === undefined
    ? `<p class="muted">No persisted completion timestamp exists in this cohort.</p>`
    : renderTime("Evidence through", snapshot.provenance.evidenceThrough);
}

function renderTime(label: string, value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Report timestamp is invalid");
  return `<p class="muted">${label} <time datetime="${escapeHtmlAttribute(value)}">${escapeHtmlText(timestamp.format(date))}</time></p>`;
}

function renderActiveFilters(filter: ReportFilter): string {
  const entries = Object.entries(filter);
  if (entries.length === 0) return `<p class="muted">Cohort filter: all persisted records.</p>`;
  const values = entries.map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : String(value)}`).join(" · ");
  return `<p class="muted">Cohort filter: ${escapeHtmlText(values)}</p>`;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en-US"));
}

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { TelemetryDatabase } from "../../reporting/db.js";
import { generateHtmlDashboard } from "../../reporting/html-dashboard.js";
import { generateMarkdownLeaderboard } from "../../reporting/markdown-leaderboard.js";
import { buildReportSnapshot } from "../../reporting/report-cohorts.js";
import type { ReportLeaderboardEntry, ReportSnapshot } from "../../reporting/report-cohorts.js";
import { renderReportCard } from "../../reporting/report-card.js";
import { publishReportOutputs } from "../../reporting/report-output.js";
import { bold, cyan, formatBadge } from "../formatter.js";
import type { CliCommandResult, CliParsedArgs, ReportOptions } from "../types.js";

export async function runReportCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startedAt = Date.now();
  const options = requireReportOptions(args.reportOptions);
  const dbPath = resolve(options.dbPath ?? resolve(process.cwd(), "benchmarks.db"));
  if (!existsSync(dbPath)) throw new TypeError("Report requires an existing benchmark database");
  const database = new TelemetryDatabase(dbPath, { readonly: true });
  try {
    const matchedRuns = database.queryRuns(options);
    const snapshot = buildReportSnapshot(matchedRuns, options, {
      includeTrends: options.includeTrends,
      includeCostEfficiency: options.includeCostEfficiency,
    });
    const card = options.exportCard === undefined ? undefined : selectCardEntry(snapshot);
    const outputs = buildOutputs(snapshot, options, card);
    if (outputs.length > 0) publishReportOutputs(outputs, [dbPath]);
    renderConsole(snapshot, options, outputs);
    return { success: true, exitCode: 0, durationMs: Date.now() - startedAt, data: snapshot };
  } finally {
    database.close();
  }
}

function buildOutputs(
  snapshot: ReportSnapshot,
  options: ReportOptions,
  card: ReportLeaderboardEntry | undefined
): readonly { readonly path: string; readonly content: string }[] {
  const format = options.format ?? "console";
  const output = format === "markdown"
    ? [{ path: options.outputPath ?? resolve(process.cwd(), "benchmark-report.md"), content: generateMarkdownLeaderboard(snapshot) }]
    : format === "html"
      ? [{ path: options.outputPath ?? resolve(process.cwd(), "benchmark-dashboard.html"), content: generateHtmlDashboard(snapshot, { title: options.title }) }]
      : format === "json" && options.outputPath !== undefined
        ? [{ path: options.outputPath, content: `${JSON.stringify(snapshot, null, 2)}\n` }]
        : [];
  if (options.exportCard === undefined || card === undefined) return output;
  const extension = options.exportCard === "svg" ? "svg" : "html";
  return [...output, {
    path: options.cardOutputPath ?? resolve(process.cwd(), `report-card.${extension}`),
    content: renderReportCard(card, options.exportCard),
  }];
}

function selectCardEntry(snapshot: ReportSnapshot): ReportLeaderboardEntry {
  if (snapshot.eligibleRunCount === 0) throw new TypeError("Report card requires eligible benchmark evidence");
  if (snapshot.leaderboard.length !== 1 || snapshot.filter.skillIds?.length !== 1) {
    throw new TypeError("Report card requires one exact eligible skill cohort");
  }
  const entry = snapshot.leaderboard[0];
  if (entry === undefined || entry.skillId !== snapshot.filter.skillIds[0]) throw new TypeError("Report card cohort is ambiguous");
  return entry;
}

function renderConsole(
  snapshot: ReportSnapshot,
  options: ReportOptions,
  outputs: readonly { readonly path: string }[]
): void {
  const format = options.format ?? "console";
  if (format === "json" && options.outputPath === undefined) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }
  if (format === "console") {
    console.log(`Matched: ${snapshot.matchedRunCount} | Eligible: ${snapshot.eligibleRunCount} | Diagnostic: ${snapshot.diagnosticRunCount}`);
    if (snapshot.provenance.simulatedRunCount > 0) console.log("SIMULATED / UNRANKED diagnostic evidence is present.");
    if (snapshot.eligibleRunCount === 0) console.log("NO ELIGIBLE BENCHMARK EVIDENCE");
    for (const entry of snapshot.leaderboard) {
      console.log(`${entry.rank}. ${bold(entry.skillId)} | ${entry.category} | samples ${entry.eligibleRunCount} | pass ${entry.passRate.toFixed(1)}% | score ${entry.score.mean.toFixed(2)}`);
    }
  }
  for (const output of outputs) console.log(`  ${formatBadge("success", "EXPORT")} Written to ${cyan(output.path)}`);
}

function requireReportOptions(options: ReportOptions | undefined): ReportOptions {
  if (options === undefined) throw new TypeError("Report options are unavailable");
  return options;
}

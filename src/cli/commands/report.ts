import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { TelemetryDatabase } from "../../reporting/db.js";
import { generateHtmlDashboard } from "../../reporting/html-dashboard.js";
import { generateMarkdownLeaderboard } from "../../reporting/markdown-leaderboard.js";
import { buildReportSnapshot } from "../../reporting/report-cohorts.js";
import type { ReportLeaderboardEntry, ReportSnapshot } from "../../reporting/report-cohorts.js";
import { renderReportCard } from "../../reporting/report-card.js";
import { publishReportOutputs } from "../../reporting/report-output.js";
import { CliInputError } from "../grammar/types.js";
import { bold } from "../formatter.js";
import type { CliCommandResult, CliOutput, CliParsedArgs, ReportOptions } from "../types.js";

export async function runReportCommand(
  args: CliParsedArgs,
  output: CliOutput,
): Promise<CliCommandResult> {
  const startedAt = Date.now();
  const options = requireOptions(args.reportOptions);
  const dbPath = resolve(requireDatabasePath(options.dbPath));
  requireExistingDatabase(dbPath);
  const database = new TelemetryDatabase(dbPath, { readonly: true });
  try {
    const matchedRuns = database.queryRuns(options);
    const snapshot = buildReportSnapshot(matchedRuns, options, {
      includeCostEfficiency: options.includeCostEfficiency,
    });
    const card = options.exportCard === undefined ? undefined : selectCardEntry(snapshot);
    const outputs = buildOutputs(snapshot, options, card);
    if (outputs.length > 0) publishReportOutputs(outputs, [dbPath]);
    renderResult(snapshot, options, outputs.length, output);
    return { success: true, exitCode: 0, durationMs: Date.now() - startedAt, data: snapshot };
  } finally {
    database.close();
  }
}

function buildOutputs(
  snapshot: ReportSnapshot,
  options: ReportOptions,
  card: ReportLeaderboardEntry | undefined,
): readonly { readonly path: string; readonly content: string }[] {
  const format = options.format ?? "console";
  const reportOutput =
    format === "markdown"
      ? [
          {
            path: requireOutputPath(options.outputPath),
            content: generateMarkdownLeaderboard(snapshot),
          },
        ]
      : format === "html"
        ? [
            {
              path: requireOutputPath(options.outputPath),
              content: generateHtmlDashboard(snapshot, { title: options.title }),
            },
          ]
        : format === "json" && options.outputPath !== undefined
          ? [{ path: options.outputPath, content: `${JSON.stringify(snapshot, null, 2)}\n` }]
          : [];
  if (options.exportCard === undefined || card === undefined) return reportOutput;
  return [
    ...reportOutput,
    {
      path: requireOutputPath(options.cardOutputPath),
      content: renderReportCard(card, options.exportCard),
    },
  ];
}

function selectCardEntry(snapshot: ReportSnapshot): ReportLeaderboardEntry {
  if (snapshot.eligibleRunCount === 0)
    throw new TypeError("Report card requires eligible benchmark evidence");
  if (snapshot.leaderboard.length !== 1 || snapshot.filter.skillIds?.length !== 1) {
    throw new TypeError("Report card requires one exact eligible skill cohort");
  }
  const entry = snapshot.leaderboard[0];
  if (entry === undefined || entry.skillId !== snapshot.filter.skillIds[0]) {
    throw new TypeError("Report card cohort is ambiguous");
  }
  return entry;
}

function renderResult(
  snapshot: ReportSnapshot,
  options: ReportOptions,
  outputCount: number,
  output: CliOutput,
): void {
  const format = options.format ?? "console";
  if (format === "json" && options.outputPath === undefined) {
    output.stdout(`${JSON.stringify(snapshot, null, 2)}\n`);
    return;
  }
  if (format === "console") {
    output.stdout(
      `Matched: ${snapshot.matchedRunCount} | Eligible: ${snapshot.eligibleRunCount} | Diagnostic: ${snapshot.diagnosticRunCount}\n`,
    );
    if (snapshot.provenance.simulatedRunCount > 0)
      output.stdout("SIMULATED / UNRANKED diagnostic evidence is present.\n");
    if (snapshot.eligibleRunCount === 0) output.stdout("NO ELIGIBLE BENCHMARK EVIDENCE\n");
    for (const entry of snapshot.leaderboard) {
      output.stdout(
        `${entry.rank}. ${bold(entry.skillId)} | ${entry.category} | samples ${entry.eligibleRunCount} | pass ${entry.passRate.toFixed(1)}% | score ${entry.score.mean.toFixed(2)}\n`,
      );
    }
  }
  if (outputCount > 0) output.stderr("Report output written.\n");
}

function requireOptions(options: ReportOptions | undefined): ReportOptions {
  if (options === undefined) throw new TypeError("Report options are unavailable");
  return options;
}

function requireDatabasePath(value: string | undefined): string {
  if (value === undefined) throw new CliInputError("report_database_unavailable");
  return value;
}

function requireExistingDatabase(path: string): void {
  try {
    if (!lstatSync(path).isFile()) throw new CliInputError("report_database_unavailable");
  } catch (error) {
    if (error instanceof CliInputError) throw error;
    throw new CliInputError("report_database_unavailable");
  }
}

function requireOutputPath(value: string | undefined): string {
  if (value === undefined) throw new CliInputError("invalid_configuration");
  return value;
}

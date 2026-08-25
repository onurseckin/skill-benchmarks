import { basename, dirname, extname, join, resolve } from "node:path";
import { createRunArtifactLayout } from "../../infrastructure/workspace/run-artifact-layout.js";
import { TelemetryDatabase } from "../../reporting/db.js";
import type { RunRecord } from "../../reporting/types.js";
import {
  loadReplaySession,
  requireDistinctReplayOutput,
  writeReplayExportAtomic,
  type ReplayEvidenceIdentity,
  type ReplaySession,
} from "../../replay/index.js";
import { TuiReplayPlayer } from "../../replay/tui-player.js";
import { generateWebReplayHtml } from "../../replay/web-player.js";
import { cyan, formatBadge } from "../formatter.js";
import type { CliCommandResult, CliParsedArgs, ReplayCliOptions } from "../types.js";

export async function runReplayCommand(args: CliParsedArgs): Promise<CliCommandResult> {
  const startedMs = Date.now();
  const options = args.replayOptions ?? ({} as ReplayCliOptions);
  validateReplayArguments(args, options);
  const loaded = loadRequestedSession(options);
  const session = loaded.session;
  const format = options.format ?? "tui";
  if (format === "json") exportJson(session, options.outputPath, loaded.protectedPaths);
  else if (format === "html") exportHtml(session, options, loaded.protectedPaths);
  else await new TuiReplayPlayer(session, { playbackSpeed: options.speed ?? 1 }).playInteractive();
  return { success: true, exitCode: 0, durationMs: Date.now() - startedMs, data: session };
}

function validateReplayArguments(args: CliParsedArgs, options: ReplayCliOptions): void {
  const hasDirectSource = options.target !== undefined;
  const canonicalParts = [options.runId, options.dbPath, options.outputDir].filter((value) => value !== undefined).length;
  if (args.positionals.length > 1 || args.flags.target !== undefined || args.flags.web !== undefined || args.flags.live !== undefined) {
    throw new TypeError("Replay command arguments are invalid");
  }
  if ((!hasDirectSource && canonicalParts === 0) || (hasDirectSource && canonicalParts > 0) || (canonicalParts > 0 && canonicalParts !== 3)) {
    throw new TypeError("Replay source is incomplete");
  }
  const format = options.format ?? "tui";
  if (!new Set(["tui", "json", "html"]).has(format)) throw new TypeError("Replay format is unsupported");
  if (format === "tui" && options.outputPath !== undefined) throw new TypeError("TUI replay does not write an export");
  if (options.speed !== undefined && (!Number.isFinite(options.speed) || options.speed <= 0)) {
    throw new TypeError("Replay speed is invalid");
  }
  if (hasDirectSource) {
    const extension = extname(options.target as string).toLowerCase();
    if (extension !== ".jsonl" && extension !== ".json") throw new TypeError("Replay source extension is unsupported");
    requireDistinctReplayOutput(options.outputPath, [options.target as string]);
  }
}

interface LoadedReplayRequest {
  readonly session: ReplaySession;
  readonly protectedPaths: readonly string[];
}

function loadRequestedSession(options: ReplayCliOptions): LoadedReplayRequest {
  if (options.target !== undefined) {
    return { session: loadReplaySession({ eventsPath: options.target }), protectedPaths: [options.target] };
  }
  const runId = requireValue(options.runId);
  const dbPath = requireValue(options.dbPath);
  const outputRoot = requireValue(options.outputDir);
  const layout = createRunArtifactLayout(outputRoot, runId);
  const protectedPaths = [layout.eventsPath, layout.manifestPath, layout.resultPath, dbPath];
  requireDistinctReplayOutput(options.outputPath, protectedPaths);
  const database = new TelemetryDatabase(dbPath, { readonly: true, authorityRoot: outputRoot });
  try {
    const record = database.getRunRecord(runId);
    if (record === undefined) throw new TypeError("Replay run identity is unavailable");
    const session = loadReplaySession({
      eventsPath: layout.eventsPath,
      manifestPath: layout.manifestPath,
      resultPath: layout.resultPath,
      expectedRunId: runId,
      expectedIdentity: createExpectedIdentity(record),
    });
    return { session, protectedPaths };
  } finally {
    database.close();
  }
}

function createExpectedIdentity(record: RunRecord): ReplayEvidenceIdentity {
  return {
    sourceKind: "canonical-run",
    runId: record.runId,
    sweepId: record.sweepId,
    cellId: record.cellId,
    planFingerprint: record.planFingerprint,
    matrixOccurrenceIndex: requireMatrixOccurrenceIndex(record.matrixOccurrenceIndex),
    scenarioId: record.scenarioId,
    category: record.category,
    skillId: record.skillId,
    modelId: record.modelId,
    providerId: record.providerId,
    executionMode: record.executionMode,
    simulated: record.simulated,
    dryRun: record.dryRun,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    status: record.status,
    terminationReason: record.terminationReason,
    durationMs: record.wallClockMs,
    totalCostUSD: record.operationalCost.amountUSD,
    totalTurns: record.totalTurns,
    totalTokens: record.totalTokens,
    benchmarkCohort: record.benchmarkCohort,
    eligibilityStatus: record.eligibility.status,
    eligibilityReasons: record.eligibility.reasons,
    evaluationStatus: record.evaluation.status,
  };
}

function exportJson(session: ReplaySession, outputPath: string | undefined, protectedPaths: readonly string[]): void {
  const content = `${JSON.stringify(session, null, 2)}\n`;
  if (outputPath === undefined) {
    console.log(content.trimEnd());
    return;
  }
  writeReplayExportAtomic(outputPath, content, protectedPaths);
  console.log(`  ${formatBadge("success", "EXPORT")} Replay JSON exported to ${cyan(resolve(outputPath))}`);
}

function exportHtml(session: ReplaySession, options: ReplayCliOptions, protectedPaths: readonly string[]): void {
  const outputPath = options.outputPath ?? deriveHtmlOutputPath(session, options);
  writeReplayExportAtomic(outputPath, generateWebReplayHtml(session), protectedPaths);
  console.log(`  ${formatBadge("success", "EXPORT")} Web Replay exported to ${cyan(resolve(outputPath))}`);
}

function deriveHtmlOutputPath(session: ReplaySession, options: ReplayCliOptions): string {
  if (options.target !== undefined) {
    const extension = extname(options.target);
    return join(dirname(resolve(options.target)), `${basename(options.target, extension)}.replay.html`);
  }
  return join(resolve(requireValue(options.outputDir)), "exports", `${session.metadata.runId}.replay.html`);
}

function requireValue(value: string | undefined): string {
  if (value === undefined) throw new TypeError("Replay source is incomplete");
  return value;
}

function requireMatrixOccurrenceIndex(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Replay run identity is incomplete");
  }
  return value;
}

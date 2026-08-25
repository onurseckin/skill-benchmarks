import { extname } from "node:path";
import { createRunArtifactLayout } from "../../infrastructure/workspace/run-artifact-layout.js";
import { TelemetryDatabase } from "../../reporting/db.js";
import type { RunRecord } from "../../reporting/types.js";
import {
  loadReplaySession,
  ReplayEvidenceInvalidError,
  ReplayEvidenceUnavailableError,
  requireDistinctReplayOutput,
  writeReplayExportAtomic,
  type ReplayEvidenceIdentity,
  type ReplaySession,
} from "../../replay/index.js";
import { TuiReplayPlayer } from "../../replay/tui-player.js";
import { generateWebReplayHtml } from "../../replay/web-player.js";
import { CliInputError } from "../grammar/types.js";
import type { CliCommandResult, CliOutput, CliParsedArgs, ReplayCliOptions } from "../types.js";

export async function runReplayCommand(
  args: CliParsedArgs,
  output: CliOutput
): Promise<CliCommandResult> {
  const startedAt = Date.now();
  const options = requireOptions(args.replayOptions);
  const loaded = loadRequestedSession(options);
  const format = options.format ?? "tui";
  if (format === "json") exportJson(loaded.session, options.outputPath, loaded.protectedPaths, output);
  else if (format === "html") exportHtml(loaded.session, options.outputPath, loaded.protectedPaths, output);
  else await new TuiReplayPlayer(loaded.session, { playbackSpeed: options.speed ?? 1 }).playInteractive();
  return { success: true, exitCode: 0, durationMs: Date.now() - startedAt, data: loaded.session };
}

interface LoadedReplayRequest {
  readonly session: ReplaySession;
  readonly protectedPaths: readonly string[];
}

function loadRequestedSession(options: ReplayCliOptions): LoadedReplayRequest {
  try {
    if (options.target !== undefined) {
      const extension = extname(options.target).toLowerCase();
      if (extension !== ".jsonl" && extension !== ".json") throw new CliInputError("invalid_value");
      requireDistinctReplayOutput(options.outputPath, [options.target]);
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
      if (record === undefined) throw new ReplayEvidenceUnavailableError();
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
  } catch (error) {
    if (error instanceof CliInputError
      || error instanceof ReplayEvidenceUnavailableError
      || error instanceof ReplayEvidenceInvalidError) throw error;
    throw new ReplayEvidenceUnavailableError();
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

function exportJson(
  session: ReplaySession,
  outputPath: string | undefined,
  protectedPaths: readonly string[],
  output: CliOutput
): void {
  const content = `${JSON.stringify(session, null, 2)}\n`;
  if (outputPath === undefined) {
    output.stdout(content);
    return;
  }
  writeReplayExportAtomic(outputPath, content, protectedPaths);
  output.stderr("Replay JSON written.\n");
}

function exportHtml(
  session: ReplaySession,
  outputPath: string | undefined,
  protectedPaths: readonly string[],
  output: CliOutput
): void {
  if (outputPath === undefined) throw new CliInputError("invalid_configuration");
  writeReplayExportAtomic(outputPath, generateWebReplayHtml(session), protectedPaths);
  output.stderr("Replay HTML written.\n");
}

function requireOptions(options: ReplayCliOptions | undefined): ReplayCliOptions {
  if (options === undefined) throw new TypeError("Replay options are unavailable");
  return options;
}

function requireValue(value: string | undefined): string {
  if (value === undefined) throw new ReplayEvidenceUnavailableError();
  return value;
}

function requireMatrixOccurrenceIndex(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
    throw new ReplayEvidenceInvalidError();
  }
  return value;
}

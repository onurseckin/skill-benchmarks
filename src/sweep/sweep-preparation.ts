import { existsSync } from "node:fs";
import { join } from "node:path";
import { TelemetryDatabase } from "../reporting/db.js";
import { CheckpointLedger } from "./checkpoint.js";
import { validateCheckpointTemporaryFiles } from "./checkpoint-storage.js";
import { generateMatrixCells } from "./matrix-cell-planner.js";
import { createSweepOutcomePath } from "./sweep-outcome.js";
import { createSweepPlanFingerprint } from "./sweep-plan.js";
import {
  validateCheckpointTerminalEvidence,
  validateSweepOutcomeEvidence,
} from "./terminal-reconciliation.js";
import type { MatrixSweepConfig } from "./types.js";

export async function prepareSweepExecution(
  sweepId: string,
  config: MatrixSweepConfig,
  initialStartedAt: string,
) {
  let startedAt = initialStartedAt;
  const checkpointPath =
    config.checkpoint?.filePath ??
    join(config.runtimeConfig.outputRoot, "sweeps", sweepId, "checkpoint.json");
  const allPlannedCells = generateMatrixCells(sweepId, config);
  const telemetryDbPath =
    config.telemetryDbPath ?? join(config.runtimeConfig.outputRoot, "db", "benchmarks.sqlite");
  const planFingerprint = createSweepPlanFingerprint({
    sweepId,
    checkpointPath,
    telemetryDbPath,
    config,
    cells: allPlannedCells,
  });
  const checkpointLedger = new CheckpointLedger(
    checkpointPath,
    {
      sweepId,
      scenarioIds: config.scenarioIds,
      skillIds: config.skillIds,
      modelIds: config.models.map((model) => model.modelId),
      repetitions: config.repetitions ?? 1,
      totalPlannedCells: allPlannedCells.length,
      planFingerprint,
      sweepStartedAt: startedAt,
    },
    config.checkpoint,
  );
  let checkpointLoaded = false;
  if (config.checkpoint?.autoResume) {
    checkpointLoaded = (await checkpointLedger.load()) !== null;
    if (checkpointLoaded) startedAt = checkpointLedger.getState().metadata.sweepStartedAt;
    validateCheckpointTemporaryFiles(checkpointPath);
    const readOnlyDb = existsSync(telemetryDbPath)
      ? new TelemetryDatabase(telemetryDbPath, {
          readonly: true,
          authorityRoot: config.runtimeConfig.outputRoot,
        })
      : undefined;
    try {
      validateCheckpointTerminalEvidence(
        allPlannedCells,
        checkpointLedger.getState(),
        readOnlyDb,
        config,
      );
      validateSweepOutcomeEvidence(
        createSweepOutcomePath(config.runtimeConfig.outputRoot, sweepId),
        allPlannedCells,
        checkpointLedger.getState(),
        readOnlyDb,
        planFingerprint,
        checkpointLoaded,
      );
    } finally {
      readOnlyDb?.close();
    }
  }
  return {
    allPlannedCells,
    checkpointLedger,
    checkpointLoaded,
    checkpointPath,
    planFingerprint,
    startedAt,
    telemetryDbPath,
  };
}

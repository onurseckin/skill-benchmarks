import type { ExecutionLimits } from "../runner/types.js";
import { createSafeArtifactPathSegment } from "../shared/artifact-sanitization.js";
import {
  createImmutableExecutionLimits,
  createImmutableModelEntry,
} from "./immutable-plan-data.js";
import type { MatrixCellDescriptor, MatrixSweepConfig } from "./types.js";

export function generateMatrixCells(
  sweepId: string,
  config: MatrixSweepConfig,
): readonly MatrixCellDescriptor[] {
  const reps = config.repetitions ?? 1;
  const limits: ExecutionLimits = createImmutableExecutionLimits({
    maxTurns: 10,
    maxWallClockTimeMs: 120000,
    maxCostUSD: 0.5,
    maxConsecutiveToolFailures: 3,
    toolTimeoutMs: 30000,
    maxOutputSizeBytes: 1024 * 1024,
    ...config.defaultExecutionLimits,
  });
  const scenarioIds = [...config.scenarioIds];
  const skillIds = [...config.skillIds];
  const models = config.models.map(createImmutableModelEntry);
  const cells: MatrixCellDescriptor[] = [];
  const cellIds = new Set<string>();
  const runIds = new Set<string>();
  let matrixOccurrenceIndex = 0;
  const thinkingLevels =
    config.thinkingLevels !== undefined && config.thinkingLevels.length > 0
      ? [...config.thinkingLevels]
      : [undefined];
  for (const [scenarioIndex, scenarioId] of scenarioIds.entries()) {
    for (const [skillIndex, skillId] of skillIds.entries()) {
      for (const [modelIndex, modelEntry] of models.entries()) {
        for (const [thinkingIndex, thinkingLevel] of thinkingLevels.entries()) {
          for (let repetitionIndex = 0; repetitionIndex < reps; repetitionIndex += 1) {
            const effectiveThinking = thinkingLevel ?? modelEntry.thinkingLevel;
            const effectiveProviderId =
              config.runtimeConfig.requestedProviderId ?? modelEntry.providerId;
            const executionMode = config.dryRun ? "fake" : config.runtimeConfig.executionMode;
            const identityTuple = [
              scenarioId,
              skillId,
              modelEntry.modelId,
              effectiveProviderId,
              executionMode,
              effectiveThinking ?? null,
              modelEntry.thinkingBudget ?? null,
              modelEntry.temperature ?? null,
              scenarioIndex,
              skillIndex,
              modelIndex,
              thinkingIndex,
              repetitionIndex,
              matrixOccurrenceIndex,
            ];
            const cellId = createSafeArtifactPathSegment(
              JSON.stringify(["cell", ...identityTuple]),
              "cell",
            );
            const runId = createSafeArtifactPathSegment(
              JSON.stringify(["run", sweepId, cellId, matrixOccurrenceIndex]),
              "run",
            );
            if (cellIds.has(cellId) || runIds.has(runId))
              throw new TypeError("Matrix occurrence identity collision");
            cellIds.add(cellId);
            runIds.add(runId);
            cells.push(
              Object.freeze({
                sweepId,
                cellId,
                matrixOccurrenceIndex,
                scenarioId,
                skillId,
                modelId: modelEntry.modelId,
                providerId: effectiveProviderId,
                executionMode,
                outputRoot: config.runtimeConfig.outputRoot,
                thinkingLevel: effectiveThinking,
                thinkingBudget: modelEntry.thinkingBudget,
                repetitionIndex,
                runId,
                modelEntry,
                limits,
                temperature: modelEntry.temperature,
                tags: modelEntry.tags,
                metadata: modelEntry.metadata,
              }),
            );
            matrixOccurrenceIndex += 1;
          }
        }
      }
    }
  }
  return Object.freeze(cells);
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MatrixSweepEngine } from "../../sweep/sweep-engine.js";
import { createSweepOutcomePath } from "../../sweep/sweep-outcome.js";
import type { CheckpointState, MatrixSweepConfig } from "../../sweep/types.js";
import { requireCondition } from "./assertions.js";

interface OutcomeCell {
  readonly cellId: string;
  readonly status: string;
  readonly terminationReason: string;
  readonly publicStatus: string;
}

interface SweepOutcomeFixture {
  readonly status: string;
  readonly terminalCells: readonly OutcomeCell[];
  readonly abortedCount: number;
  readonly failedCount: number;
}

export async function verifyAbortedSweepTerminalization(temporaryRoot: string): Promise<void> {
  const outputRoot = join(temporaryRoot, "sweep-output");
  const checkpointPath = join(outputRoot, "checkpoint.json");
  const sweepId = "fixture-abort-terminalization";
  const engine = new MatrixSweepEngine(sweepId);
  let abortIssued = false;
  engine.on((event) => {
    if (event.type !== "cell:start" || abortIssued) return;
    abortIssued = true;
    return engine.abort("fixture abort after first cell start");
  });

  const summary = await engine.run(createConfig(outputRoot, checkpointPath, sweepId));
  const outcome = JSON.parse(
    readFileSync(createSweepOutcomePath(outputRoot, sweepId), "utf8"),
  ) as SweepOutcomeFixture;
  const checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8")) as CheckpointState;
  const summaryByCell = new Map(summary.results.map((result) => [result.cell.cellId, result]));
  const outcomeByCell = new Map(outcome.terminalCells.map((cell) => [cell.cellId, cell]));
  const checkpointByCell = checkpoint.completedResults;

  requireCondition(abortIssued, "sweep_abort_fixture_triggered");
  requireCondition(summary.status === "aborted", "sweep_abort_summary_status");
  requireCondition(outcome.status === "aborted", "sweep_abort_outcome_status");
  requireCondition(checkpoint.status === "aborted", "sweep_abort_checkpoint_status");
  requireCondition(summary.results.length === 2, "sweep_abort_summary_terminal_count");
  requireCondition(outcome.terminalCells.length === 2, "sweep_abort_outcome_terminal_count");
  requireCondition(Object.keys(checkpointByCell).length === 2, "sweep_abort_checkpoint_terminal_count");

  for (const [cellId, result] of summaryByCell) {
    const outcomeCell = outcomeByCell.get(cellId);
    const checkpointResult = checkpointByCell[cellId];
    requireCondition(result.runRecord?.status === "aborted", "sweep_abort_summary_cell_status");
    requireCondition(result.status === "aborted", "sweep_abort_summary_public_status");
    requireCondition(
      result.runRecord?.terminationReason === "aborted",
      "sweep_abort_summary_cell_reason",
    );
    requireCondition(outcomeCell?.status === "aborted", "sweep_abort_outcome_cell_status");
    requireCondition(
      outcomeCell?.publicStatus === "aborted",
      "sweep_abort_outcome_public_status",
    );
    requireCondition(
      outcomeCell?.terminationReason === "aborted",
      "sweep_abort_outcome_cell_reason",
    );
    requireCondition(
      checkpointResult?.runRecord?.status === "aborted",
      "sweep_abort_checkpoint_cell_status",
    );
    requireCondition(
      checkpointResult?.status === "aborted",
      "sweep_abort_checkpoint_public_status",
    );
    requireCondition(
      checkpointResult?.runRecord?.terminationReason === "aborted",
      "sweep_abort_checkpoint_cell_reason",
    );
  }
  requireCondition(outcome.abortedCount === 2, "sweep_abort_outcome_aborted_count");
  requireCondition(outcome.failedCount === 0, "sweep_abort_outcome_failed_count");
}

function createConfig(
  outputRoot: string,
  checkpointPath: string,
  sweepId: string,
): MatrixSweepConfig {
  return {
    runtimeConfig: { executionMode: "fake", outputRoot },
    sweepId,
    scenarioIds: ["git-worktrees"],
    skillIds: ["tdd"],
    models: [{ modelId: "gpt-4o", providerId: "openai" }],
    repetitions: 2,
    dryRun: true,
    maxRetriesPerCell: 0,
    concurrency: { maxGlobalConcurrency: 1 },
    checkpoint: { enabled: true, filePath: checkpointPath },
  };
}

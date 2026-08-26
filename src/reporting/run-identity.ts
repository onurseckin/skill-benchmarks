import type { Database } from "bun:sqlite";

export class TerminalRunIdentityConflictError extends Error {
  public constructor() {
    super("Terminal run identity already exists");
    this.name = "TerminalRunIdentityConflictError";
  }
}

export function claimTerminalRunIdentity(
  db: Database,
  runId: string,
  sweepId: string,
  cellId: string,
): void {
  try {
    db.transaction(() => {
      if (db.prepare("SELECT run_id FROM runs WHERE run_id = ?").get(runId) !== null) {
        throw new TerminalRunIdentityConflictError();
      }
      db.prepare(
        "INSERT INTO run_claims (run_id, sweep_id, cell_id, created_at) VALUES (?, ?, ?, ?)",
      ).run(runId, sweepId, cellId, new Date().toISOString());
    })();
  } catch (error) {
    if (error instanceof TerminalRunIdentityConflictError) throw error;
    if (db.prepare("SELECT run_id FROM run_claims WHERE run_id = ?").get(runId) !== null) {
      throw new TerminalRunIdentityConflictError();
    }
    throw error;
  }
}

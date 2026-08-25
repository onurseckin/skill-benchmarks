import { Database } from "bun:sqlite";
import { validateDatabasePathBeforeOpen } from "./database-path-authority.js";
import { ReportingQueryStore } from "./query-store.js";
import { ReportingRunStore } from "./run-store.js";
import { initializeReportingSchema, validateReportingSchema } from "./schema.js";
import type {
  EligibleRunRecord,
  RunQueryFilter,
  RunRecord,
  TelemetryEventRecord,
} from "./types.js";

export { TerminalRunIdentityConflictError } from "./run-identity.js";

export class TelemetryDatabase {
  private readonly database: Database;
  private readonly runStore: ReportingRunStore;
  private readonly queryStore: ReportingQueryStore;

  public constructor(
    dbPath: string = ":memory:",
    options?: { readonly readonly?: boolean; readonly authorityRoot?: string }
  ) {
    validateDatabasePathBeforeOpen(dbPath, options?.authorityRoot);
    const database = options?.readonly === true
      ? new Database(dbPath, { readonly: true })
      : new Database(dbPath);
    try {
      validateDatabasePathBeforeOpen(dbPath, options?.authorityRoot);
      this.database = database;
      if (options?.readonly === true) validateReportingSchema(database);
      else initializeReportingSchema(database);
      this.runStore = new ReportingRunStore(database);
      this.queryStore = new ReportingQueryStore(database);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  public initSchema(): void {
    initializeReportingSchema(this.database);
  }

  public saveRunRecord(record: RunRecord): void {
    this.runStore.saveRunRecord(record);
  }

  public saveRunRecordWithArtifact(record: RunRecord, commitArtifact: () => void): void {
    this.runStore.saveRunRecordWithArtifact(record, commitArtifact);
  }

  public claimRunIdentity(runId: string, sweepId: string, cellId: string): void {
    this.runStore.claimRunIdentity(runId, sweepId, cellId);
  }

  public getRunRecord(runId: string): RunRecord | undefined {
    return this.queryStore.getRunRecord(runId);
  }

  public saveTelemetryEvents(events: ReadonlyArray<TelemetryEventRecord>): void {
    this.runStore.saveTelemetryEvents(events);
  }

  public queryRuns(filter?: RunQueryFilter): readonly RunRecord[] {
    return this.queryStore.queryRuns(filter);
  }

  public queryEligibleRuns(filter?: RunQueryFilter): readonly EligibleRunRecord[] {
    return this.queryStore.queryEligibleRuns(filter);
  }

  public updateEloScore(
    candidate: EligibleRunRecord,
    opponent: EligibleRunRecord,
    result: 1 | 0.5 | 0,
    kFactor: number = 32
  ): void {
    this.queryStore.updateEloScore(candidate, opponent, result, kFactor);
  }

  public getEloLeaderboard() {
    return this.queryStore.getEloLeaderboard();
  }

  public getHistoricalTrends(skillId?: string) {
    return this.queryStore.getHistoricalTrends(skillId);
  }

  public close(): void {
    this.database.close();
  }
}

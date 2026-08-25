import { Database } from "bun:sqlite";
import type {
  EloRatingRecord,
  HistoricalTrendPoint,
  RunEvaluationSummary,
  RunManifest,
  RunMetricsSummary,
  RunQueryFilter,
  RunRecord,
  RunStatus,
  TelemetryEventRecord,
} from "./types.js";

interface RunRow {
  readonly run_id: string;
  readonly scenario_id: string;
  readonly category: string;
  readonly skill_id: string;
  readonly skill_version: string | null;
  readonly model_id: string;
  readonly provider_id: string;
  readonly thinking_level: string | null;
  readonly thinking_budget_tokens: number | null;
  readonly reasoning_tokens: number | null;
  readonly status: string;
  readonly composite_score: number;
  readonly passed_benchmark: number;
  readonly wall_clock_ms: number;
  readonly total_tokens: number;
  readonly cache_hit_ratio: number;
  readonly total_cost_usd: number;
  readonly total_turns: number;
  readonly error_count: number;
  readonly started_at: string;
  readonly completed_at: string;
  readonly manifest_json: string | null;
  readonly metrics_json: string | null;
  readonly evaluation_json: string | null;
  readonly commit_sha: string | null;
}

interface EloRow {
  readonly skill_id: string;
  readonly rating: number;
  readonly matches_played: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly last_updated: string;
}

interface TrendRow {
  readonly timestamp: string;
  readonly commit_sha: string | null;
  readonly skill_version: string | null;
  readonly pass_rate: number;
  readonly average_score: number;
  readonly mean_duration_ms: number;
  readonly average_cost_usd: number;
  readonly elo_rating: number;
  readonly sample_count: number;
}

function parseJsonField<T>(raw: string | null): T | undefined {
  return raw && raw !== "" ? (JSON.parse(raw) as T) : undefined;
}

function mapRowToRunRecord(row: RunRow): RunRecord {
  const manifest = parseJsonField<RunManifest>(row.manifest_json);
  const metrics = parseJsonField<RunMetricsSummary>(row.metrics_json);
  const evaluation = parseJsonField<RunEvaluationSummary>(row.evaluation_json);
  return {
    runId: row.run_id,
    scenarioId: row.scenario_id,
    category: row.category,
    skillId: row.skill_id,
    ...(row.skill_version !== null ? { skillVersion: row.skill_version } : {}),
    modelId: row.model_id,
    providerId: row.provider_id,
    ...(row.thinking_level !== null ? { thinkingLevel: row.thinking_level as RunRecord["thinkingLevel"] } : {}),
    ...(row.thinking_budget_tokens !== null ? { thinkingBudgetTokens: row.thinking_budget_tokens } : {}),
    ...(row.reasoning_tokens !== null ? { reasoningTokens: row.reasoning_tokens } : {}),
    status: row.status as RunStatus,
    compositeScore: row.composite_score,
    passedBenchmark: row.passed_benchmark === 1,
    wallClockMs: row.wall_clock_ms,
    totalTokens: row.total_tokens,
    cacheHitRatio: row.cache_hit_ratio,
    totalCostUSD: row.total_cost_usd,
    totalTurns: row.total_turns,
    errorCount: row.error_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    ...(manifest !== undefined ? { manifest } : {}),
    ...(metrics !== undefined ? { metrics } : {}),
    ...(evaluation !== undefined ? { evaluation } : {}),
  };
}

function computeConfidenceInterval(wins: number, ties: number, matches: number): readonly [number, number] {
  if (matches <= 0) return [0, 0] as const;
  const score = (wins + 0.5 * ties) / matches;
  const z = 1.96;
  const z2 = z * z;
  const denominator = 1 + z2 / matches;
  const center = (score + z2 / (2 * matches)) / denominator;
  const margin = (z * Math.sqrt((score * (1 - score) + z2 / (4 * matches)) / matches)) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)] as const;
}

export class TelemetryDatabase {
  private readonly db: Database;

  public constructor(dbPath: string = ":memory:") {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  public initSchema(): void {
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL, category TEXT NOT NULL,
        skill_id TEXT NOT NULL, skill_version TEXT, model_id TEXT NOT NULL,
        provider_id TEXT NOT NULL, thinking_level TEXT, thinking_budget_tokens INTEGER, reasoning_tokens INTEGER,
        status TEXT NOT NULL, composite_score REAL NOT NULL,
        passed_benchmark INTEGER NOT NULL, wall_clock_ms REAL NOT NULL,
        total_tokens INTEGER NOT NULL, cache_hit_ratio REAL NOT NULL,
        total_cost_usd REAL NOT NULL, total_turns INTEGER NOT NULL,
        error_count INTEGER NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL,
        manifest_json TEXT, metrics_json TEXT, evaluation_json TEXT, commit_sha TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_scenario_id ON runs(scenario_id);
      CREATE INDEX IF NOT EXISTS idx_runs_skill_id ON runs(skill_id);
      CREATE INDEX IF NOT EXISTS idx_runs_model_id ON runs(model_id);
      CREATE INDEX IF NOT EXISTS idx_runs_provider_id ON runs(provider_id);
      CREATE INDEX IF NOT EXISTS idx_runs_category ON runs(category);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
      CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
      CREATE INDEX IF NOT EXISTS idx_runs_completed_at ON runs(completed_at);
      CREATE INDEX IF NOT EXISTS idx_runs_skill_completed ON runs(skill_id, completed_at);

      CREATE TABLE IF NOT EXISTS telemetry_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, scenario_id TEXT NOT NULL,
        skill_id TEXT, model_id TEXT NOT NULL, timestamp_us TEXT NOT NULL,
        event_type TEXT NOT NULL, sequence_number INTEGER, payload_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_telemetry_run_id ON telemetry_events(run_id);
      CREATE INDEX IF NOT EXISTS idx_telemetry_event_type ON telemetry_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry_events(timestamp_us);

      CREATE TABLE IF NOT EXISTS elo_ratings (
        skill_id TEXT PRIMARY KEY, rating REAL NOT NULL, matches_played INTEGER NOT NULL,
        wins INTEGER NOT NULL, losses INTEGER NOT NULL, ties INTEGER NOT NULL, last_updated TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_elo_rating ON elo_ratings(rating DESC);
    `);
    try { this.db.exec("ALTER TABLE runs ADD COLUMN thinking_level TEXT;"); } catch {}
    try { this.db.exec("ALTER TABLE runs ADD COLUMN thinking_budget_tokens INTEGER;"); } catch {}
    try { this.db.exec("ALTER TABLE runs ADD COLUMN reasoning_tokens INTEGER;"); } catch {}
  }

  public saveRunRecord(record: RunRecord): void {
    const skillVersion = record.skillVersion ?? record.manifest?.skillVersion ?? null;
    const commitSha = record.manifest?.environment?.hostCommitSha ?? null;
    const manifestJson = record.manifest ? JSON.stringify(record.manifest) : null;
    const metricsJson = record.metrics ? JSON.stringify(record.metrics) : null;
    const evaluationJson = record.evaluation ? JSON.stringify(record.evaluation) : null;

    const stmt = this.db.prepare(`
      INSERT INTO runs (
        run_id, scenario_id, category, skill_id, skill_version, model_id, provider_id,
        thinking_level, thinking_budget_tokens, reasoning_tokens,
        status, composite_score, passed_benchmark, wall_clock_ms, total_tokens, cache_hit_ratio,
        total_cost_usd, total_turns, error_count, started_at, completed_at,
        manifest_json, metrics_json, evaluation_json, commit_sha
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        scenario_id = excluded.scenario_id, category = excluded.category,
        skill_id = excluded.skill_id, skill_version = excluded.skill_version,
        model_id = excluded.model_id, provider_id = excluded.provider_id,
        thinking_level = excluded.thinking_level,
        thinking_budget_tokens = excluded.thinking_budget_tokens,
        reasoning_tokens = excluded.reasoning_tokens,
        status = excluded.status, composite_score = excluded.composite_score,
        passed_benchmark = excluded.passed_benchmark, wall_clock_ms = excluded.wall_clock_ms,
        total_tokens = excluded.total_tokens, cache_hit_ratio = excluded.cache_hit_ratio,
        total_cost_usd = excluded.total_cost_usd, total_turns = excluded.total_turns,
        error_count = excluded.error_count, started_at = excluded.started_at,
        completed_at = excluded.completed_at, manifest_json = excluded.manifest_json,
        metrics_json = excluded.metrics_json, evaluation_json = excluded.evaluation_json,
        commit_sha = excluded.commit_sha
    `);

    stmt.run(
      record.runId, record.scenarioId, record.category, record.skillId, skillVersion,
      record.modelId, record.providerId,
      record.thinkingLevel ?? record.manifest?.modelParameters?.thinkingLevel ?? null,
      record.thinkingBudgetTokens ?? record.manifest?.modelParameters?.thinkingBudgetTokens ?? null,
      record.reasoningTokens ?? null,
      record.status, record.compositeScore,
      record.passedBenchmark ? 1 : 0, record.wallClockMs, record.totalTokens,
      record.cacheHitRatio, record.totalCostUSD, record.totalTurns, record.errorCount,
      record.startedAt, record.completedAt, manifestJson, metricsJson, evaluationJson, commitSha
    );
  }

  public saveTelemetryEvents(events: ReadonlyArray<TelemetryEventRecord>): void {
    if (events.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT INTO telemetry_events (
        run_id, scenario_id, skill_id, model_id, timestamp_us, event_type, sequence_number, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertTransaction = this.db.transaction((records: ReadonlyArray<TelemetryEventRecord>) => {
      for (const event of records) {
        stmt.run(
          event.runId, event.scenarioId, event.skillId ?? null, event.modelId,
          event.timestampUs, event.eventType, event.sequenceNumber ?? null,
          event.payload ? JSON.stringify(event.payload) : null
        );
      }
    });
    insertTransaction(events);
  }

  public queryRuns(filter?: RunQueryFilter): ReadonlyArray<RunRecord> {
    const clauses: string[] = [];
    const bindings: (string | number)[] = [];

    if (filter?.scenarioId !== undefined) { clauses.push("scenario_id = ?"); bindings.push(filter.scenarioId); }
    if (filter?.skillId !== undefined) { clauses.push("skill_id = ?"); bindings.push(filter.skillId); }
    if (filter?.modelId !== undefined) { clauses.push("model_id = ?"); bindings.push(filter.modelId); }
    if (filter?.providerId !== undefined) { clauses.push("provider_id = ?"); bindings.push(filter.providerId); }
    if (filter?.category !== undefined) { clauses.push("category = ?"); bindings.push(filter.category); }
    if (filter?.status !== undefined) { clauses.push("status = ?"); bindings.push(filter.status); }
    if (filter?.passedBenchmark !== undefined) { clauses.push("passed_benchmark = ?"); bindings.push(filter.passedBenchmark ? 1 : 0); }
    if (filter?.minScore !== undefined) { clauses.push("composite_score >= ?"); bindings.push(filter.minScore); }
    if (filter?.maxScore !== undefined) { clauses.push("composite_score <= ?"); bindings.push(filter.maxScore); }
    if (filter?.fromDate !== undefined) { clauses.push("started_at >= ?"); bindings.push(filter.fromDate); }
    if (filter?.toDate !== undefined) { clauses.push("started_at <= ?"); bindings.push(filter.toDate); }

    let sql = "SELECT * FROM runs";
    if (clauses.length > 0) sql += ` WHERE ${clauses.join(" AND ")}`;
    sql += " ORDER BY started_at ASC";

    if (filter?.limit !== undefined) { sql += " LIMIT ?"; bindings.push(filter.limit); }
    if (filter?.offset !== undefined) { sql += " OFFSET ?"; bindings.push(filter.offset); }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...bindings) as RunRow[];
    return rows.map(mapRowToRunRecord);
  }

  public updateEloScore(
    skillId: string,
    opponentSkillId: string,
    result: 1 | 0.5 | 0,
    kFactor: number = 32
  ): void {
    const getStmt = this.db.prepare("SELECT * FROM elo_ratings WHERE skill_id = ?");
    const existingA = getStmt.get(skillId) as EloRow | null;
    const existingB = getStmt.get(opponentSkillId) as EloRow | null;

    const ratingA = existingA ? existingA.rating : 1500;
    const ratingB = existingB ? existingB.rating : 1500;
    const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
    const expectedB = 1 - expectedA;

    const newRatingA = ratingA + kFactor * (result - expectedA);
    const newRatingB = ratingB + kFactor * (1 - result - expectedB);

    const matchesA = (existingA?.matches_played ?? 0) + 1;
    const winsA = (existingA?.wins ?? 0) + (result === 1 ? 1 : 0);
    const lossesA = (existingA?.losses ?? 0) + (result === 0 ? 1 : 0);
    const tiesA = (existingA?.ties ?? 0) + (result === 0.5 ? 1 : 0);

    const matchesB = (existingB?.matches_played ?? 0) + 1;
    const winsB = (existingB?.wins ?? 0) + (result === 0 ? 1 : 0);
    const lossesB = (existingB?.losses ?? 0) + (result === 1 ? 1 : 0);
    const tiesB = (existingB?.ties ?? 0) + (result === 0.5 ? 1 : 0);

    const now = new Date().toISOString();
    const upsertStmt = this.db.prepare(`
      INSERT INTO elo_ratings (skill_id, rating, matches_played, wins, losses, ties, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(skill_id) DO UPDATE SET
        rating = excluded.rating, matches_played = excluded.matches_played,
        wins = excluded.wins, losses = excluded.losses, ties = excluded.ties, last_updated = excluded.last_updated
    `);

    const updateTransaction = this.db.transaction(() => {
      upsertStmt.run(skillId, newRatingA, matchesA, winsA, lossesA, tiesA, now);
      upsertStmt.run(opponentSkillId, newRatingB, matchesB, winsB, lossesB, tiesB, now);
    });
    updateTransaction();
  }

  public getEloLeaderboard(): ReadonlyArray<EloRatingRecord> {
    const stmt = this.db.prepare("SELECT * FROM elo_ratings ORDER BY rating DESC, wins DESC");
    const rows = stmt.all() as EloRow[];
    return rows.map((row) => {
      const winRate = row.matches_played > 0 ? (row.wins + 0.5 * row.ties) / row.matches_played : 0;
      const confidenceInterval95 = computeConfidenceInterval(row.wins, row.ties, row.matches_played);
      return {
        skillId: row.skill_id,
        rating: row.rating,
        matchesPlayed: row.matches_played,
        wins: row.wins,
        losses: row.losses,
        ties: row.ties,
        winRate,
        confidenceInterval95,
        lastUpdated: row.last_updated,
      };
    });
  }

  public getHistoricalTrends(skillId?: string): ReadonlyArray<HistoricalTrendPoint> {
    const hasSkillFilter = skillId !== undefined;
    const sql = `
      SELECT
        MAX(r.completed_at) AS timestamp, r.commit_sha, r.skill_version,
        AVG(r.passed_benchmark) AS pass_rate, AVG(r.composite_score) AS average_score,
        AVG(r.wall_clock_ms) AS mean_duration_ms, AVG(r.total_cost_usd) AS average_cost_usd,
        COALESCE(e.rating, 1500.0) AS elo_rating, COUNT(*) AS sample_count
      FROM runs r
      LEFT JOIN elo_ratings e ON r.skill_id = e.skill_id
      ${hasSkillFilter ? "WHERE r.skill_id = ?" : ""}
      GROUP BY r.skill_id, r.commit_sha, r.skill_version, strftime('%Y-%m-%d', r.started_at)
      ORDER BY timestamp ASC
    `;
    const stmt = this.db.prepare(sql);
    const rows = (hasSkillFilter ? stmt.all(skillId) : stmt.all()) as TrendRow[];
    return rows.map((row) => ({
      timestamp: row.timestamp,
      ...(row.commit_sha !== null ? { commitSha: row.commit_sha } : {}),
      ...(row.skill_version !== null ? { skillVersion: row.skill_version } : {}),
      passRate: row.pass_rate,
      averageScore: row.average_score,
      meanDurationMs: row.mean_duration_ms,
      averageCostUSD: row.average_cost_usd,
      eloRating: row.elo_rating,
      sampleCount: row.sample_count,
    }));
  }

  public close(): void {
    this.db.close();
  }
}

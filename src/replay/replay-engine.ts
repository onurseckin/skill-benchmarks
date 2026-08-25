import { parseReplayJsonl, parseReplaySessionJson } from "./event-session-loader.js";
import type {
  CgroupTelemetryPoint,
  ReplayEvidenceIdentity,
  ReplaySession,
  ReplaySummary,
  TrajectoryFrame,
} from "./types.js";

export class ReplayEngine {
  public constructor(private readonly session: ReplaySession) {}

  public getFrame(index: number): TrajectoryFrame | undefined {
    return this.session.frames[index];
  }

  public getFrames(): readonly TrajectoryFrame[] {
    return this.session.frames;
  }

  public getFrameCount(): number {
    return this.session.frames.length;
  }

  public findFrames(predicate: (frame: TrajectoryFrame) => boolean): readonly TrajectoryFrame[] {
    return this.session.frames.filter(predicate);
  }

  public getTelemetryWindow(startMs: number, endMs: number): readonly CgroupTelemetryPoint[] {
    return this.session.telemetrySeries.filter((point) => point.timestampMs >= startMs && point.timestampMs <= endMs);
  }

  public getSession(): ReplaySession {
    return this.session;
  }

  public getSummary(): ReplaySummary {
    const cpuValues = this.session.telemetrySeries.map((point) => point.cpuPercent);
    const memoryValues = this.session.telemetrySeries.map((point) => point.memoryRssMb);
    return {
      frameCount: this.session.frames.length,
      turnCount: this.session.metadata.totalTurns,
      toolCallCount: this.session.metadata.totalToolCalls,
      ...(cpuValues.length === 0 ? {} : { peakCpuPercent: Math.max(...cpuValues) }),
      ...(memoryValues.length === 0 ? {} : { peakMemoryMb: Math.max(...memoryValues) }),
      totalInsertions: this.session.diffs.reduce((sum, diff) => sum + diff.insertions, 0),
      totalDeletions: this.session.diffs.reduce((sum, diff) => sum + diff.deletions, 0),
      executionStatus: this.session.metadata.executionStatus,
    };
  }

  public toJson(pretty: boolean = false): string {
    return JSON.stringify(this.session, null, pretty ? 2 : undefined);
  }

  public static fromJson(content: string): ReplaySession {
    return parseReplaySessionJson(content);
  }

  public static fromJsonl(content: string, identity?: ReplayEvidenceIdentity): ReplaySession {
    return parseReplayJsonl(content, identity);
  }
}

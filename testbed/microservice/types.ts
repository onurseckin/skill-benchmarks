export interface MicroserviceEvent {
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: number;
}

export interface WorkerJobResult {
  readonly eventId: string;
  readonly status: "completed" | "failed" | "deadlocked";
  readonly workerId: number;
  readonly processedAt: number;
}

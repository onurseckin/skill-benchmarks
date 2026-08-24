import type { Server } from "bun";
import { TelemetryDatabase } from "../reporting/db.js";
import { ApiRouter } from "./api-router.js";
import type {
  HttpServerInstance,
  LiveTelemetryPayload,
  ServerOptions,
  ServerState,
  SseClient,
  SseEvent,
} from "./index.js";

const TEXT_ENCODER = new TextEncoder();

export class HttpServer implements HttpServerInstance {
  public readonly options: ServerOptions;
  public readonly router: ApiRouter;
  private readonly db: TelemetryDatabase;
  private readonly ownsDb: boolean;
  private readonly sseClients = new Set<SseClient>();
  private bunServer: Server<unknown> | null = null;
  private isRunningState = false;
  private startedAtIso = "";
  private requestCount = 0;
  private eventCount = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  public constructor(options: ServerOptions = {}, router?: ApiRouter) {
    this.options = options;
    this.router = router ?? new ApiRouter();
    if (options.db) {
      this.db = options.db;
      this.ownsDb = false;
    } else {
      this.db = new TelemetryDatabase(options.dbPath ?? ":memory:");
      this.ownsDb = true;
    }
  }

  public get url(): string {
    const host = this.options.hostname ?? "localhost";
    const port = (this.bunServer ? this.bunServer.port : undefined) ?? this.options.port ?? 3000;
    return `http://${host}:${port}`;
  }

  public get port(): number {
    return (this.bunServer ? this.bunServer.port : undefined) ?? this.options.port ?? 3000;
  }

  public get hostname(): string {
    return this.options.hostname ?? "localhost";
  }

  public getState(): ServerState {
    return {
      port: this.port,
      hostname: this.hostname,
      isRunning: this.isRunningState,
      activeConnections: this.sseClients.size,
      activeSseClients: this.sseClients.size,
      startedAt: this.startedAtIso,
      url: this.url,
      totalRequestsHandled: this.requestCount,
      totalEventsBroadcast: this.eventCount,
    };
  }

  public getDatabase(): TelemetryDatabase {
    return this.db;
  }

  public async start(): Promise<void> {
    if (this.isRunningState) return;

    const port = this.options.port ?? 3000;
    const hostname = this.options.hostname ?? "0.0.0.0";
    this.startedAtIso = new Date().toISOString();

    this.bunServer = Bun.serve({
      port,
      hostname,
      fetch: (req) => this.handleRequest(req),
      error: (err) => {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    this.isRunningState = true;
    this.startHeartbeat();

    if (!this.options.quiet) {
      console.log(`📡 Skill Benchmarks Telemetry Server running at ${this.url}`);
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunningState) return;

    this.stopHeartbeat();

    for (const client of this.sseClients) {
      try {
        client.controller.close();
      } catch {}
    }
    this.sseClients.clear();

    if (this.bunServer) {
      this.bunServer.stop(true);
      this.bunServer = null;
    }

    if (this.ownsDb) {
      this.db.close();
    }

    this.isRunningState = false;
  }

  public broadcast(event: SseEvent, runIdFilter?: string): void {
    const serialized = this.serializeSseMessage(event);
    const encoded = TEXT_ENCODER.encode(serialized);
    this.eventCount += 1;

    for (const client of this.sseClients) {
      if (runIdFilter && client.filterRunId && client.filterRunId !== runIdFilter) {
        continue;
      }
      try {
        client.controller.enqueue(encoded);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  public broadcastTelemetry(payload: LiveTelemetryPayload): void {
    this.broadcast(
      {
        event: payload.eventType ?? "telemetry",
        data: payload,
      },
      payload.runId
    );
  }

  private async handleRequest(req: Request): Promise<Response> {
    this.requestCount += 1;
    const url = new URL(req.url);

    if (url.pathname === "/api/telemetry/events" || url.pathname === "/api/sse") {
      return this.handleSseConnection(req, url);
    }

    return this.router.handle(
      req,
      this.db,
      this.getState(),
      (event, runIdFilter) => this.broadcast(event, runIdFilter)
    );
  }

  private handleSseConnection(req: Request, url: URL): Response {
    if (this.options.enableSse === false) {
      return new Response("SSE disabled", { status: 403 });
    }

    const filterRunId = url.searchParams.get("runId") ?? undefined;
    const clientId = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let clientRef: SseClient | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        clientRef = {
          id: clientId,
          controller,
          connectedAt: new Date().toISOString(),
          filterRunId,
        };
        this.sseClients.add(clientRef);

        const welcome = this.serializeSseMessage({
          event: "connected",
          data: {
            clientId,
            filterRunId: filterRunId ?? null,
            serverTime: new Date().toISOString(),
          },
        });
        controller.enqueue(TEXT_ENCODER.encode(welcome));
      },
      cancel: () => {
        if (clientRef) {
          this.sseClients.delete(clientRef);
        }
      },
    });

    req.signal.addEventListener("abort", () => {
      if (clientRef) {
        this.sseClients.delete(clientRef);
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  private serializeSseMessage(event: SseEvent): string {
    let msg = "";
    if (event.id) msg += `id: ${event.id}\n`;
    if (event.event) msg += `event: ${event.event}\n`;
    if (event.retry !== undefined) msg += `retry: ${event.retry}\n`;
    const rawData = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
    const dataLines = rawData.split("\n");
    for (const line of dataLines) {
      msg += `data: ${line}\n`;
    }
    msg += "\n";
    return msg;
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (!this.isRunningState) return;
      const ping = this.serializeSseMessage({
        event: "heartbeat",
        data: {
          timestamp: new Date().toISOString(),
          clients: this.sseClients.size,
        },
      });
      const encoded = TEXT_ENCODER.encode(ping);
      for (const client of this.sseClients) {
        try {
          client.controller.enqueue(encoded);
        } catch {
          this.sseClients.delete(client);
        }
      }
    }, 15000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}

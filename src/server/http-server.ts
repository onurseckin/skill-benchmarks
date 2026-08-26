import type { Server } from "bun";
import { TelemetryDatabase } from "../reporting/db.js";
import { ApiRouter } from "./api-router.js";
import { normalizeServerOptions, type NormalizedServerOptions } from "./server-authority.js";
import { errorResponse } from "./server-response.js";
import type { HttpServerInstance, ServerOptions, ServerState } from "./types.js";

export class HttpServer implements HttpServerInstance {
  public readonly options: ServerOptions;
  private readonly normalized: NormalizedServerOptions;
  private readonly router = new ApiRouter();
  private database: TelemetryDatabase | null = null;
  private bunServer: Server<unknown> | null = null;
  private isRunningState = false;
  private startedAtIso = "";
  private requestCount = 0;

  public constructor(options: ServerOptions) {
    this.normalized = normalizeServerOptions(options);
    this.options = Object.freeze({ ...this.normalized });
  }

  public get url(): string {
    return `http://${this.hostname}:${this.port}`;
  }

  public get port(): number {
    return this.bunServer?.port ?? this.normalized.port;
  }

  public get hostname(): "127.0.0.1" {
    return this.normalized.hostname;
  }

  public getState(): ServerState {
    return {
      port: this.port,
      hostname: this.hostname,
      isRunning: this.isRunningState,
      startedAt: this.startedAtIso,
      url: this.url,
      totalRequestsHandled: this.requestCount,
    };
  }

  public async start(): Promise<void> {
    if (this.isRunningState) return;
    const database = new TelemetryDatabase(this.normalized.dbPath, {
      readonly: true,
      authorityRoot: this.normalized.outputRoot,
    });
    try {
      this.database = database;
      const bunServer = Bun.serve({
        port: this.normalized.port,
        hostname: this.normalized.hostname,
        fetch: (request) => this.handleRequest(request),
        error: () => errorResponse("internal_error", 500),
      });
      this.bunServer = bunServer;
      this.startedAtIso = new Date().toISOString();
      this.isRunningState = true;
      if (!this.normalized.quiet) process.stdout.write(`Reader server available at ${this.url}\n`);
    } catch (error) {
      this.database = null;
      database.close();
      throw error;
    }
  }

  public async stop(): Promise<void> {
    const bunServer = this.bunServer;
    const database = this.database;
    this.bunServer = null;
    this.database = null;
    this.isRunningState = false;
    if (bunServer !== null) await bunServer.stop(true);
    if (database !== null) database.close();
  }

  private async handleRequest(request: Request): Promise<Response> {
    this.requestCount += 1;
    const database = this.database;
    if (database === null) return errorResponse("internal_error", 500);
    return this.router.handle(request, database, this.normalized.outputRoot, this.getState());
  }
}

import type { Server, ServerWebSocket } from "bun";
import { decodeBinaryFrame, encodeBinaryFrame } from "./binary-frame-codec.js";
export { decodeBinaryFrame, encodeBinaryFrame } from "./binary-frame-codec.js";
import { PtyMultiplexer } from "./pty-multiplexer.js";
import {
  collectTunnelClientSessions,
  type SseClientData,
  type WsClientData,
} from "./tunnel-client-sessions.js";
export type { WsClientData } from "./tunnel-client-sessions.js";
import {
  type BinaryFrameEnvelope,
  type PtyMultiplexerInstance,
  type StreamPacket,
  type TunnelClientRole,
  type TunnelClientSession,
  type TunnelServerOptions,
  type TunnelServerState,
  type StreamTunnelInstance,
} from "./types.js";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export class StreamTunnelServer implements StreamTunnelInstance {
  public readonly options: TunnelServerOptions;
  public readonly multiplexer: PtyMultiplexerInstance;
  private bunServer: Server<WsClientData> | null = null;
  private readonly wsClients = new Map<ServerWebSocket<WsClientData>, WsClientData>();
  private readonly sseClients = new Map<string, SseClientData>();
  private isRunningState = false;
  private startedAtIso = "";
  private totalTransferred = 0;
  private totalFrames = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  public constructor(options: TunnelServerOptions = {}, multiplexer?: PtyMultiplexerInstance) {
    this.options = options;
    this.multiplexer = multiplexer ?? new PtyMultiplexer();
  }

  public get url(): string {
    const host = this.options.hostname ?? "localhost";
    const port = (this.bunServer ? this.bunServer.port : undefined) ?? this.options.port ?? 4000;
    return `http://${host}:${port}`;
  }

  public get wsUrl(): string {
    const host = this.options.hostname ?? "localhost";
    const port = (this.bunServer ? this.bunServer.port : undefined) ?? this.options.port ?? 4000;
    return `ws://${host}:${port}/tunnel`;
  }

  public getState(): TunnelServerState {
    const host = this.options.hostname ?? "localhost";
    const port = (this.bunServer ? this.bunServer.port : undefined) ?? this.options.port ?? 4000;
    return {
      port,
      hostname: host,
      isRunning: this.isRunningState,
      activeWebSockets: this.wsClients.size,
      activeSseStreams: this.sseClients.size,
      totalSessions: this.multiplexer.listSessions().length,
      startedAt: this.startedAtIso,
      url: this.url,
      wsUrl: this.wsUrl,
      totalBytesTransferred: this.totalTransferred,
      totalFramesProcessed: this.totalFrames,
    };
  }

  public getClientSessions(): readonly TunnelClientSession[] {
    return collectTunnelClientSessions(this.wsClients, this.sseClients, this.startedAtIso);
  }

  public async start(): Promise<void> {
    if (this.isRunningState) return;
    const port = this.options.port ?? 4000;
    const hostname = this.options.hostname ?? "0.0.0.0";
    const self = this;

    this.bunServer = Bun.serve<WsClientData>({
      port,
      hostname,
      fetch(req, server) {
        const url = new URL(req.url);
        if (url.pathname === "/tunnel" || url.pathname === "/ws") {
          const sessionId = url.searchParams.get("sessionId") ?? "default";
          const role = (url.searchParams.get("role") as TunnelClientRole) ?? "interactive";
          const authKey = url.searchParams.get("token") ?? url.searchParams.get("authKey");
          if (self.options.authTokens && self.options.authTokens.length > 0) {
            if (!authKey || !self.options.authTokens.includes(authKey)) {
              return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { "content-type": "application/json" },
              });
            }
          }
          const clientId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const upgraded = server.upgrade(req, {
            data: {
              clientId,
              sessionId,
              role,
              connectedAt: new Date().toISOString(),
              lastPingAt: new Date().toISOString(),
            },
          });
          if (upgraded) return undefined;
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        if (url.pathname.startsWith("/api/tunnel/") && url.pathname.endsWith("/stream")) {
          const parts = url.pathname.split("/");
          const sessionId = parts[3] ?? "default";
          return self.handleSseStream(sessionId, req);
        }
        if (url.pathname === "/health" || url.pathname === "/api/health") {
          return new Response(JSON.stringify({ status: "healthy", ...self.getState() }), {
            headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
          });
        }
        return new Response("Not Found", { status: 404 });
      },
      websocket: {
        open(ws) {
          self.handleWsOpen(ws);
        },
        message(ws, message) {
          self.handleWsMessage(ws, message);
        },
        close(ws, code, reason) {
          self.handleWsClose(ws, code, reason);
        },
      },
    });

    this.isRunningState = true;
    this.startedAtIso = new Date().toISOString();
    const interval = this.options.heartbeatIntervalMs ?? 15000;
    this.heartbeatTimer = setInterval(() => this.runHeartbeat(), interval);
  }

  public async stop(): Promise<void> {
    if (!this.isRunningState) return;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const [ws] of this.wsClients) {
      try {
        ws.close(1001, "Server shutting down");
      } catch {}
    }
    this.wsClients.clear();
    for (const [, sse] of this.sseClients) {
      try {
        sse.controller.close();
      } catch {}
    }
    this.sseClients.clear();
    if (this.bunServer) {
      this.bunServer.stop(true);
      this.bunServer = null;
    }
    this.isRunningState = false;
  }

  private handleWsOpen(ws: ServerWebSocket<WsClientData>): void {
    const data = ws.data;
    this.wsClients.set(ws, data);
    if (!this.multiplexer.hasSession(data.sessionId)) {
      this.multiplexer.createSession({
        sessionId: data.sessionId,
        containerId: `container-${data.sessionId}`,
      });
    }
    this.multiplexer.onOutput(data.sessionId, (chunk, channel, seq) => {
      if (ws.readyState === 1) {
        if (this.options.enableBinaryFraming) {
          const frame = encodeBinaryFrame(channel, seq, Date.now(), chunk);
          ws.send(frame);
          this.totalTransferred += frame.byteLength;
        } else {
          const text = TEXT_DECODER.decode(chunk);
          ws.send(
            JSON.stringify({ channel, sessionId: data.sessionId, data: text, sequence: seq }),
          );
          this.totalTransferred += chunk.byteLength;
        }
        this.totalFrames += 1;
      }
    });
    const scrollback = this.multiplexer.getScrollback(data.sessionId);
    if (scrollback.length > 0) {
      ws.send(
        JSON.stringify({
          channel: "scrollback_replay",
          sessionId: data.sessionId,
          lines: scrollback,
          totalLines: scrollback.length,
          totalBytes: scrollback.reduce((acc, l) => acc + l.length, 0),
        }),
      );
    }
  }

  private handleWsMessage(
    ws: ServerWebSocket<WsClientData>,
    message: string | Buffer | Uint8Array,
  ): void {
    const data = ws.data;
    data.lastPingAt = new Date().toISOString();
    this.totalFrames += 1;

    if (typeof message === "string") {
      this.totalTransferred += message.length;
      try {
        const parsed = JSON.parse(message) as StreamPacket;
        this.processStreamPacket(ws, parsed);
      } catch {
        ws.send(
          JSON.stringify({
            channel: "error",
            code: "INVALID_JSON",
            message: "Failed to parse message JSON",
          }),
        );
      }
      return;
    }

    const uint8 = message instanceof Uint8Array ? message : new Uint8Array(message);
    this.totalTransferred += uint8.byteLength;
    const envelope = decodeBinaryFrame(uint8);
    if (envelope) {
      this.processBinaryFrame(ws, envelope);
    } else {
      if (data.role !== "readonly") {
        this.multiplexer.writeStdin(data.sessionId, uint8);
      }
    }
  }

  private processStreamPacket(ws: ServerWebSocket<WsClientData>, packet: StreamPacket): void {
    const data = ws.data;
    const targetSessionId =
      "sessionId" in packet && packet.sessionId ? packet.sessionId : data.sessionId;
    switch (packet.channel) {
      case "stdin":
        if (data.role !== "readonly") this.multiplexer.writeStdin(targetSessionId, packet.data);
        break;
      case "resize":
        this.multiplexer.resizeSession(targetSessionId, packet.dimensions);
        break;
      case "ping":
        ws.send(
          JSON.stringify({
            channel: "pong",
            sessionId: targetSessionId,
            clientTimestamp: packet.clientTimestamp,
            serverTimestamp: Date.now(),
          }),
        );
        break;
      case "scrollback_request":
        const lines = this.multiplexer.getScrollback(
          targetSessionId,
          packet.maxLines,
          packet.maxBytes,
        );
        ws.send(
          JSON.stringify({
            channel: "scrollback_replay",
            sessionId: targetSessionId,
            lines,
            totalLines: lines.length,
            totalBytes: lines.join("").length,
          }),
        );
        break;
      case "control":
        if (packet.signal === "pause") this.multiplexer.pauseSession(targetSessionId);
        if (packet.signal === "resume") this.multiplexer.resumeSession(targetSessionId);
        break;
    }
  }

  private processBinaryFrame(
    ws: ServerWebSocket<WsClientData>,
    envelope: BinaryFrameEnvelope,
  ): void {
    const data = ws.data;
    if (envelope.channel === "stdin" && data.role !== "readonly") {
      this.multiplexer.writeStdin(data.sessionId, envelope.payload);
    } else if (envelope.channel === "ping") {
      const pongFrame = encodeBinaryFrame("pong", envelope.sequence, Date.now(), new Uint8Array(0));
      ws.send(pongFrame);
    }
  }

  private handleWsClose(ws: ServerWebSocket<WsClientData>, _code: number, _reason: string): void {
    this.wsClients.delete(ws);
  }

  private handleSseStream(sessionId: string, _req: Request): Response {
    let sseId = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const self = this;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        self.sseClients.set(sseId, { sessionId, controller, role: "readonly" });
        if (!self.multiplexer.hasSession(sessionId)) {
          self.multiplexer.createSession({ sessionId, containerId: `container-${sessionId}` });
        }
        controller.enqueue(
          TEXT_ENCODER.encode(`event: ready\ndata: ${JSON.stringify({ sessionId })}\n\n`),
        );
        self.multiplexer.onOutput(sessionId, (chunk, channel, seq) => {
          try {
            const text = TEXT_DECODER.decode(chunk);
            controller.enqueue(
              TEXT_ENCODER.encode(
                `event: ${channel}\ndata: ${JSON.stringify({ text, sequence: seq })}\n\n`,
              ),
            );
          } catch {}
        });
      },
      cancel() {
        self.sseClients.delete(sseId);
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "access-control-allow-origin": "*",
      },
    });
  }

  private runHeartbeat(): void {
    const now = Date.now();
    for (const [ws, data] of this.wsClients) {
      if (ws.readyState === 1) {
        ws.send(
          JSON.stringify({ channel: "ping", sessionId: data.sessionId, clientTimestamp: now }),
        );
      }
    }
    for (const [, sse] of this.sseClients) {
      try {
        sse.controller.enqueue(TEXT_ENCODER.encode(`: ping ${now}\n\n`));
      } catch {}
    }
  }

  public broadcastToSession(sessionId: string, packet: StreamPacket): number {
    let sent = 0;
    const payload = JSON.stringify(packet);
    for (const [ws, data] of this.wsClients) {
      if (data.sessionId === sessionId && ws.readyState === 1) {
        ws.send(payload);
        sent += 1;
      }
    }
    return sent;
  }

  public broadcastBinaryToSession(sessionId: string, envelope: BinaryFrameEnvelope): number {
    let sent = 0;
    const frame = encodeBinaryFrame(
      envelope.channel,
      envelope.sequence,
      envelope.timestamp,
      envelope.payload,
    );
    for (const [ws, data] of this.wsClients) {
      if (data.sessionId === sessionId && ws.readyState === 1) {
        ws.send(frame);
        sent += 1;
      }
    }
    return sent;
  }
}

export function createStreamTunnel(
  options?: TunnelServerOptions,
  multiplexer?: PtyMultiplexerInstance,
): StreamTunnelServer {
  return new StreamTunnelServer(options, multiplexer);
}

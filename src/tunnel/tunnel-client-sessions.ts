import type { ServerWebSocket } from "bun";
import type { TunnelClientRole, TunnelClientSession } from "./types.js";

export interface WsClientData {
  readonly clientId: string;
  readonly sessionId: string;
  readonly role: TunnelClientRole;
  readonly connectedAt: string;
  lastPingAt: string;
}

export interface SseClientData {
  readonly sessionId: string;
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
  readonly role: TunnelClientRole;
}

export function collectTunnelClientSessions(
  webSockets: ReadonlyMap<ServerWebSocket<WsClientData>, WsClientData>,
  serverEvents: ReadonlyMap<string, SseClientData>,
  startedAt: string,
): readonly TunnelClientSession[] {
  const sessions: TunnelClientSession[] = [];
  for (const data of webSockets.values()) {
    sessions.push({
      clientId: data.clientId,
      sessionId: data.sessionId,
      role: data.role,
      connectionState: "open",
      connectedAt: data.connectedAt,
      lastPingAt: data.lastPingAt,
      protocol: "websocket",
    });
  }
  for (const [clientId, data] of serverEvents) {
    sessions.push({
      clientId,
      sessionId: data.sessionId,
      role: data.role,
      connectionState: "open",
      connectedAt: startedAt,
      lastPingAt: new Date().toISOString(),
      protocol: "sse",
    });
  }
  return sessions;
}

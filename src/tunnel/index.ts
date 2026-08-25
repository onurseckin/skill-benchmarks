import {
  AnsiSequenceMatch,
  BackpressureOptions,
  BinaryFrameEnvelope,
  CHANNEL_TO_CODE,
  CODE_TO_CHANNEL,
  FRAME_HEADER_LENGTH,
  FRAME_HEADER_MAGIC,
  FRAME_HEADER_VERSION,
  MultiplexerSessionStatus,
  PtyErrorListener,
  PtyExitListener,
  PtyMultiplexerInstance,
  PtyOutputListener,
  PtyResizeListener,
  PtySessionConfig,
  PtySessionState,
  PtySessionStats,
  RingBufferEntry,
  RingBufferOptions,
  StreamChannel,
  StreamChannelCode,
  StreamPacket,
  StreamTunnelInstance,
  TerminalDimensions,
  TunnelClientRole,
  TunnelClientSession,
  TunnelConnectionState,
  TunnelProtocol,
  TunnelServerOptions,
  TunnelServerState,
} from "./types.js";

import {
  PtyMultiplexer,
  PtySession,
  RateLimiter,
  RingBuffer,
  createPtyMultiplexer,
  parseAnsiSequences,
  stripAnsi,
} from "./pty-multiplexer.js";

import {
  StreamTunnelServer,
  createStreamTunnel,
  decodeBinaryFrame,
  encodeBinaryFrame,
  type WsClientData,
} from "./stream-tunnel.js";

export type {
  AnsiSequenceMatch,
  BackpressureOptions,
  BinaryFrameEnvelope,
  MultiplexerSessionStatus,
  PtyErrorListener,
  PtyExitListener,
  PtyMultiplexerInstance,
  PtyOutputListener,
  PtyResizeListener,
  PtySessionConfig,
  PtySessionState,
  PtySessionStats,
  RingBufferEntry,
  RingBufferOptions,
  StreamChannel,
  StreamChannelCode,
  StreamPacket,
  StreamTunnelInstance,
  TerminalDimensions,
  TunnelClientRole,
  TunnelClientSession,
  TunnelConnectionState,
  TunnelProtocol,
  TunnelServerOptions,
  TunnelServerState,
  WsClientData,
};

export {
  CHANNEL_TO_CODE,
  CODE_TO_CHANNEL,
  FRAME_HEADER_LENGTH,
  FRAME_HEADER_MAGIC,
  FRAME_HEADER_VERSION,
  PtyMultiplexer,
  PtySession,
  RateLimiter,
  RingBuffer,
  StreamTunnelServer,
  createPtyMultiplexer,
  createStreamTunnel,
  decodeBinaryFrame,
  encodeBinaryFrame,
  parseAnsiSequences,
  stripAnsi,
};

export async function startStreamTunnel(
  options?: TunnelServerOptions,
  multiplexer?: PtyMultiplexerInstance
): Promise<StreamTunnelServer> {
  const tunnel = new StreamTunnelServer(options, multiplexer);
  await tunnel.start();
  return tunnel;
}

export default createStreamTunnel;

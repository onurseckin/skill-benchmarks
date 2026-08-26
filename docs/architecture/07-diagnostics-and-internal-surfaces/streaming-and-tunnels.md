# Streaming and Tunnels

[Book index](../README.md) | [Part index](README.md) | [Previous: chaos](chaos.md) | [Next part: operations](../08-operations-and-testbed/README.md)

**Status:** Implemented but not public

Streaming and tunnel components are implemented as internal transport and presentation surfaces.

`CanvasStreamer` renders terminal-oriented frames. `StreamTunnelServer` can encode and decode fixed-header binary frames, manage tunnel sessions, and host transport endpoints. `PtyMultiplexer` owns per-session output multiplexing.

## Source anchors

[`src/streaming/canvas-streamer.ts`](../../../src/streaming/canvas-streamer.ts), [`src/streaming/telemetry-broadcaster.ts`](../../../src/streaming/telemetry-broadcaster.ts), [`src/tunnel/stream-tunnel.ts`](../../../src/tunnel/stream-tunnel.ts), [`src/tunnel/pty-multiplexer.ts`](../../../src/tunnel/pty-multiplexer.ts), and [`src/tunnel/types.ts`](../../../src/tunnel/types.ts).

## Limitations

The public CLI has no server, web-stream, event-stream, or terminal-tunnel command. These modules are not a documented public protocol or live-telemetry promise.

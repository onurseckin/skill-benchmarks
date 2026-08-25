# Chapter 08: Binary Terminal Streaming Protocol

[← Previous: 07. Chaos Fault Injection](07-fuzzing-and-chaos.md) | [Architecture Index](README.md)

---

## 1. 16-Byte Binary Streaming Protocol Specification

For high-throughput, low-latency live streaming of agent terminal outputs and execution telemetry, **Skill-Benchmarks** defines a compact **16-byte binary framing protocol** implemented in [`src/tunnel/stream-tunnel.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/tunnel/stream-tunnel.ts) and [`src/streaming/canvas-streamer.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/streaming/canvas-streamer.ts).

### 1.1 Fixed-Header Binary Layout (16 Bytes)

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|       Magic Bytes (0x53 0x4B 0x4D)      | Version(0x01)| Frame Type(u8)|
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|     Channel ID (uint16_t)     |    Payload Length (uint32_t)  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                 Timestamp Epoch MS (uint64_t)                 |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      Payload Bytes (Variable)                 |
|                               ...                             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### 1.2 Binary Header Field Definitions

| Byte Offset | Field Name | Type | Description |
| :--- | :--- | :--- | :--- |
| `0x00 - 0x02` | `MAGIC_BYTES` | 3 Bytes | Fixed signature `0x53 0x4B 0x4D` (`SKM` = Skill Benchmark). |
| `0x03` | `PROTOCOL_VER` | `uint8` | Protocol version (`0x01`). |
| `0x04` | `FRAME_TYPE` | `uint8` | Frame classification (see table below). |
| `0x05 - 0x06` | `CHANNEL_ID` | `uint16` (Big-Endian) | Stream channel / terminal session identifier. |
| `0x07 - 0x0A` | `PAYLOAD_LEN` | `uint32` (Big-Endian) | Length of following payload in bytes ($N \le 65{,}536$). |
| `0x0B - 0x0F` | `TIMESTAMP` | `uint64` (Big-Endian) | Milliseconds since Unix epoch. |
| `0x10 - ...` | `PAYLOAD` | $N$ Bytes | Raw UTF-8 string or binary telemetry payload. |

### 1.3 Frame Type Taxonomy

| Frame Type ID | Name | Description |
| :--- | :--- | :--- |
| `0x01` | `STDOUT_STREAM` | Raw PTY terminal standard output chunk. |
| `0x02` | `STDERR_STREAM` | Standard error diagnostic output chunk. |
| `0x03` | `PTY_RESIZE` | PTY window dimensions change (`cols: u16, rows: u16`). |
| `0x04` | `TELEMETRY_STEP` | Serialized JSON `StepTelemetry` event. |
| `0x05` | `HEARTBEAT` | Keep-alive ping/pong frame (zero payload). |
| `0x06` | `SESSION_CLOSE` | Termination status code and exit summary. |

---

## 2. Pseudo-Terminal (PTY) Multiplexer & WebSocket Tunnel

The **PTY Multiplexer** ([`src/tunnel/pty-multiplexer.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/tunnel/pty-multiplexer.ts)) handles multi-client broadcasting and flow control:

```
+-------------------------------------------------------------------------------+
|                       PTY MULTIPLEXING ARCHITECTURE                           |
|                                                                               |
|  DOCKER CONTAINER PTY (node-pty / /dev/pts/X)                                 |
|                         │                                                     |
|                         ▼                                                     |
|  PTY MULTIPLEXER (src/tunnel/pty-multiplexer.ts)                              |
|   ├── Circular Ring Buffer (64KB sliding backlog for late subscribers)        |
|   ├── Frame Packer (Prepends 16-byte binary header)                           |
|   └── Flow Control (Backpressure queue per connected WebSocket)               |
|                         │                                                     |
|                         ▼                                                     |
|  WEBSOCKET TUNNEL (src/tunnel/stream-tunnel.ts : Port 4001)                   |
|   ├── Client 1: CLI TUI Player (bin/skill-benchmarks view <run-id>)           |
|   ├── Client 2: Interactive Web Dashboard export                             |
|   └── Client 3: CI/CD Live Stream Ingestor                                    |
+-------------------------------------------------------------------------------+
```

---

## 3. Double-Buffered UTF-8 Canvas Screen Renderer

To render flicker-free terminal sessions in headless or terminal UI environments, [`src/streaming/canvas-streamer.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/streaming/canvas-streamer.ts) maintains a double-buffered UTF-8 character matrix:

```
+-------------------------------------------------------------------------------+
|                       DOUBLE-BUFFERED SCREEN MATRIX                           |
|                                                                               |
|  INCOMING STREAM ──► [ ANSI Escape Parser ] ──► [ Back Buffer (80x24 Cells) ] |
|                                                                │              |
|                                                                ▼              |
|  TERMINAL OUTPUT ◄── [ Minimal Diff Flush ] ◄── [ Diff Comparator Engine ]   |
|                                                                ▲              |
|                                                                │              |
|                                                 [ Front Buffer (Active Display)]
+-------------------------------------------------------------------------------+
```

### 3.1 Screen Diffing & Minimal Flush Algorithm

1. Each cell stores character codepoint, foreground/background 24-bit RGB colors, and style flags (bold, underline, inverted).
2. Upon frame tick (60 FPS / 16.6ms), the comparator identifies modified bounding boxes.
3. Only changed character cells and cursor position escapes are dispatched to the client, minimizing network bandwidth by up to 94%.

---

## 4. Streaming & Tunnel Module Reference

- [`src/streaming/canvas-streamer.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/streaming/canvas-streamer.ts): Double-buffered screen matrix and ANSI terminal renderer.
- [`src/streaming/telemetry-broadcaster.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/streaming/telemetry-broadcaster.ts): Real-time telemetry broadcasting engine.
- [`src/tunnel/stream-tunnel.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/tunnel/stream-tunnel.ts): Binary WebSocket protocol tunnel server.
- [`src/tunnel/pty-multiplexer.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/tunnel/pty-multiplexer.ts): PTY stream multiplexer and frame serializer.

---

## 5. Binary Protocol Interoperability Summary

The binary protocol ensures zero-overhead multiplexing of PTY terminal sessions and execution metrics across CLI players and web dashboards.

---

[← Previous: 07. Chaos Fault Injection](07-fuzzing-and-chaos.md) | [Architecture Index](README.md)

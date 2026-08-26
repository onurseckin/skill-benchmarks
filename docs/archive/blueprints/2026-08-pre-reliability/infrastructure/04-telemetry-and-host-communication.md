# 04. Telemetry, Host Communication, and Resource Profiling

## 1. Executive Overview & Observability Architecture

Benchmarking LLM agent skills requires precise, multi-dimensional observability. Simple end-to-end execution time and binary pass/fail outcomes are insufficient to diagnose skill efficiency, resource bottlenecks, or regressions.

The telemetry infrastructure captures two concurrent channels of observability during every run:
1. **Execution Telemetry Channel**: Captures tool dispatches, commands executed inside the container, standard output/stderr streams, command duration, and return codes with microsecond resolution.
2. **Container Kernel Profiling Channel**: Continuously samples cgroups v2 resource metrics (CPU utilization %, RSS memory consumption, disk I/O reads/writes, network throughput, and active PID counts) at a configurable 100ms interval.

```
+-----------------------------------------------------------------------------------+
|                        Dual-Channel Telemetry Architecture                        |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  HOST ORCHESTRATOR (Bun / TypeScript Engine)                                       |
|                                                                                   |
|  +-------------------------------------+  +------------------------------------+  |
|  |     Command Execution Dispatcher    |  |     Container Resource Profiler    |  |
|  |  - Dispatches tool commands         |  |  - Samples Docker stats API        |  |
|  |  - Multiplexes stdout/stderr streams|  |  - 100ms high-resolution polling   |  |
|  |  - Monotonic timestamp injection    |  |  - CPU%, Memory RSS, Block I/O     |  |
|  +-------------------------------------+  +------------------------------------+  |
|                     |                                       |                     |
|                     v                                       v                     |
|  +-----------------------------------------------------------------------------+  |
|  |                   Host-Side Event Scribe (Async Batch Buffer)               |  |
|  +-----------------------------------------------------------------------------+  |
|                     |                                       |                     |
|                     v                                       v                     |
|       .benchmarks/runs/<id>/events.jsonl      .benchmarks/runs/<id>/metrics.json  |
|                                                                                   |
+-----------------------------------------------------------------------------------+
                                         |
                                         | Unix Domain Socket / Docker Engine API
                                         v
+-----------------------------------------------------------------------------------+
|  CONTAINER SANDBOX (`sb-run-<run-id>`)                                            |
|                                                                                   |
|  +-----------------------------------+  +--------------------------------------+  |
|  |        /workspace (App Code)      |  |         Linux cgroups v2 Counters    |  |
|  |  - Subprocess execution           |  |  - cpu.stat / memory.current         |  |
|  |  - stdout / stderr pipes          |  |  - io.stat / pids.current            |  |
|  +-----------------------------------+  +--------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Host-to-Container Command Dispatch & Execution Protocol

### 2.1 Execution Mechanism: Direct Docker API & Wrapper Script

Commands inside the container are dispatched via `docker exec` (or direct Docker API POST `/containers/{id}/exec`) using a hardened execution wrapper script located at `/usr/local/bin/exec-wrapper.sh`.

```bash
#!/usr/bin/env bash
# /usr/local/bin/exec-wrapper.sh
# Purpose: Execute tool commands with precise timing, environment isolation, and clean exit traps.

set -o pipefail

COMMAND="$1"
CWD="${2:-/workspace}"

cd "${CWD}" || exit 1

START_NS=$(date +%s%N)

# Execute the command passed from the orchestrator
eval "${COMMAND}"
EXIT_CODE=$?

END_NS=$(date +%s%N)
DURATION_MS=$(( (END_NS - START_NS) / 1000000 ))

# Emit execution metadata trailer to stderr delimiter
printf "\n__SB_META_TRAILER__:{\"exitCode\":%d,\"durationMs\":%d}\n" "${EXIT_CODE}" "${DURATION_MS}" >&2

exit ${EXIT_CODE}
```

### 2.2 Stream Demultiplexing & Log Capture

Docker Engine API multiplexes `stdout` and `stderr` over a single TCP/Unix connection using an 8-byte header:
- **Header Byte 0**: Stream type (`0x01` for `stdout`, `0x02` for `stderr`).
- **Header Bytes 1-3**: Reserved (`0x000000`).
- **Header Bytes 4-7**: Big-endian uint32 payload length.

The Bun host orchestrator demultiplexes these frames in real time:
1. Emits live text deltas to the runner console.
2. Appends timestamped log records to `.benchmarks/runs/<run-id>/events.jsonl`.
3. Appends raw text to `.benchmarks/runs/<run-id>/raw.log`.

---

## 3. Real-Time Stream Scribing & Log Formatting

All actions and outputs are recorded as JSON Lines in `events.jsonl`. Every event includes a high-resolution monotonic microsecond timestamp:

```typescript
export type TelemetryEventType =
  | "CONTAINER_SPAWNED"
  | "WORKSPACE_HYDRATED"
  | "TOOL_CALL_STARTED"
  | "TOOL_STDOUT_CHUNK"
  | "TOOL_STDERR_CHUNK"
  | "TOOL_CALL_COMPLETED"
  | "RESOURCE_SAMPLE"
  | "GIT_DIFF_CAPTURED"
  | "CONTAINER_TEARDOWN";

export interface TelemetryEvent {
  readonly runId: string;
  readonly sequenceNumber: number;
  readonly timestampUs: string; // Monotonic epoch microseconds as string
  readonly type: TelemetryEventType;
  readonly payload: Record<string, unknown>;
}
```

### 3.1 Unbounded Output Protection (Infinite Loop Guard)

If an agent executes a runaway command (e.g. `while true; do echo "leak"; done` or a verbose build outputting hundreds of megabytes), the host enforces strict output streaming limits:
- **Max Output Ceiling**: 5 MB per command execution.
- **Action on Ceiling Breached**: Stream truncated, warning flag `output_truncated: true` injected, and SIGTERM sent to the in-container process group.

---

## 4. Real-Time Container Resource Profiling Engine

While the agent operates, a background worker samples container resource metrics at 100ms intervals via the Docker stats streaming endpoint (`/containers/{id}/stats?stream=true`).

```typescript
export interface ResourceProfileSample {
  readonly timestampMs: number;
  readonly cpuPercent: number;
  readonly cpuUserUs: number;
  readonly cpuKernelUs: number;
  readonly memoryRssBytes: number;
  readonly memoryCacheBytes: number;
  readonly memoryLimitBytes: number;
  readonly memoryPercent: number;
  readonly diskReadBytes: number;
  readonly diskWriteBytes: number;
  readonly networkRxBytes: number;
  readonly networkTxBytes: number;
  readonly activePids: number;
}
```

### 4.1 Aggregated Resource Metrics Summary

At the conclusion of the run, samples are aggregated into `metrics.json`:

```typescript
export interface ResourceMetricsSummary {
  readonly cpu: {
    readonly peakPercent: number;
    readonly meanPercent: number;
    readonly totalCpuTimeMs: number;
  };
  readonly memory: {
    readonly peakRssBytes: number;
    readonly peakRssMb: number;
    readonly finalRssBytes: number;
    readonly limitBytes: number;
    readonly peakMemoryPercentage: number;
  };
  readonly io: {
    readonly totalDiskReadBytes: number;
    readonly totalDiskWriteBytes: number;
    readonly totalNetworkRxBytes: number;
    readonly totalNetworkTxBytes: number;
  };
  readonly processes: {
    readonly peakPidCount: number;
  };
}
```

---

## 5. Error Classification & Failure Taxonomy

The infrastructure implements a comprehensive error taxonomy to distinguish between agent reasoning errors, benchmark scenario flaws, and underlying infrastructure failures.

```
+-----------------------------------------------------------------------------------+
|                        Infrastructure Failure Taxonomy                            |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  1. INFRASTRUCTURE LEVEL FAULTS (Harness / Docker Engine)                         |
|     - ERR_DOCKER_DAEMON_UNAVAILABLE : Docker socket disconnected or unresponsive  |
|     - ERR_IMAGE_PULL_FAILED         : Required base image missing and pull failed  |
|     - ERR_VOLUME_CREATION_FAILED    : Host disk full or volume allocation error    |
|     - ERR_CONTAINER_BOOT_TIMEOUT    : Container failed to start within 10s         |
|     - ERR_OOM_KILLED (Exit 137)     : Container memory exceeded 2.0GB hard limit   |
|                                                                                   |
|  2. EXECUTION / RUNTIME TIMEOUTS (Enforced Bounds)                                |
|     - ERR_COMMAND_TIMEOUT           : Single tool execution exceeded 60s limit     |
|     - ERR_TURN_TIMEOUT              : Single LLM + Tool turn exceeded 180s limit   |
|     - ERR_SCENARIO_TIMEOUT          : Total benchmark run exceeded 900s limit      |
|                                                                                   |
|  3. AGENT TOOL CALL ERRORS (Agent Defect)                                         |
|     - ERR_INVALID_TOOL_PAYLOAD      : Unparseable JSON or schema validation error  |
|     - ERR_COMMAND_NON_ZERO_EXIT     : Script/tool failed inside guest workspace    |
|     - ERR_OUTPUT_LIMIT_EXCEEDED     : Runaway stdout generation (> 5MB)            |
|                                                                                   |
|  4. STATE & INTEGRITY ERRORS (Post-Run Validation)                                |
|     - ERR_DIFF_EXTRACTION_FAILED    : Git index corruption in workspace            |
|     - ERR_BASELINE_TAMPERING        : Agent modified immutable benchmark fixtures  |
+-----------------------------------------------------------------------------------+
```

### 5.1 Automatic Forensic Data Capture on Failure

When a container crashes or is killed by the OOM killer, the orchestrator automatically gathers forensic diagnostic data before tearing down the instance:
1. `docker inspect sb-run-<run-id>`: Extracts exact container exit code, OOMKilled boolean, and termination timestamp.
2. In-container `dmesg | tail -n 50`: Captures kernel page allocation failures or segfaults.
3. Last 100 lines of stdout/stderr before termination persisted directly to `diagnostics.json`.

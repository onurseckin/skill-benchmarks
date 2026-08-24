# 02. Container Lifecycle, Pooling, and Local Orchestration

## 1. Executive Overview & Local Orchestration Model

To execute high-throughput benchmark matrices (e.g. 50 scenarios × 4 skills × 3 models = 600 runs), the host harness requires a local container orchestration engine capable of running multiple isolated sandboxes in parallel without host resource exhaustion, disk I/O thrashing, or Docker daemon lock contention.

### 1.1 Core Architectural Principles
- **Direct Engine Communication**: Direct Docker interaction via Docker Engine API (`/var/run/docker.sock`) or high-performance subprocess execution (`Bun.spawn`), avoiding heavy multi-node container orchestrators (Kubernetes/Nomad).
- **Adaptive Concurrency Pool**: Dynamic slot allocation bounded by host CPU cores and available physical memory.
- **Hermetic Lifecycle State Machine**: Every container transitions through strict, non-skippable lifecycle stages with automatic leak cleanup on crashes or process termination.
- **Fail-Safe Resource Governance**: Strict CPU, memory, PID, and disk I/O limits per container instance.

---

## 2. Container Lifecycle State Machine

Every benchmark execution instance runs inside a dedicated, isolated container governed by the following state machine:

```
+-----------------------------------------------------------------------------------+
|                           Container Lifecycle State Machine                       |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
                                  +-------------+
                                  |   PENDING   |
                                  +-------------+
                                         |
                                         | Pool worker slot allocated
                                         v
                                  +-------------+
                                  |  CREATING   | (docker create / run -d)
                                  +-------------+
                                         |
                                         | Container started, healthcheck OK
                                         v
                                  +-------------+
                                  |  HYDRATING  | (Copy scenario fixture, init git)
                                  +-------------+
                                         |
                                         | Workspace baseline snapshot captured
                                         v
                                  +-------------+
         +----------------------->|    READY    |<------------------------+
         |                        +-------------+                         |
         |                               |                                |
         |                               | Dispatch agent tool turn       |
         |                               v                                |
         |                        +-------------+                         |
         | Next turn              |  EXECUTING  | (docker exec bash tool) |
         +------------------------|   (TURN)    |                         |
                                  +-------------+                         |
                                         |                                |
                                         | Agent completes / turn finishes |
                                         v                                |
                                  +-------------+                         |
                                  | EXTRACTING  | (Generate git diff,     |
                                  |    DIFF     |  collect telemetry)     |
                                  +-------------+                         |
                                         |                                |
                                         | Final turn completed           |
                                         v                                |
                                  +-------------+                         |
                                  |   TEARDOWN  | (docker rm -f, purge   |
                                  |             |  ephemeral volumes)     |
                                  +-------------+                         |
                                         |                                |
                                         v                                |
                                  +-------------+                         |
                                  | TERMINATED  |                         |
                                  +-------------+                         |
                                                                          |
    [ Any State on Failure / Timeout / OOM / SIGINT ]                     |
                               |                                          |
                               +--------------------->+-------------+----+
                                                      |   ERRORED   |
                                                      +-------------+
```

### 2.1 State Descriptions & Transition Guardrails

| State | Action / Responsibility | Transition Guardrail / Timeout |
|---|---|---|
| `PENDING` | Run queued in memory waiting for an available concurrency slot. | Max queue wait: 300s. |
| `CREATING` | Host spawns container with resource limits, mount arguments, and network isolation flags. | Max container boot timeout: 10s. |
| `HYDRATING` | Host unpacks scenario fixture archive into `/workspace`, creates baseline Git commit (`baseline` tag), and injects environment variables. | Max hydration timeout: 30s. |
| `READY` | Container is idle, listening, and ready to accept `exec` commands from the agent loop. | Health check verification verified via `/usr/local/bin/verify-env.sh`. |
| `EXECUTING` | Agent dispatches tool command (`bash`, `read_file`, `edit_file`) via `docker exec`. Standard output/stderr streamed in real time. | Per-command timeout: $\le 60$s. Per-turn timeout: $\le 180$s. |
| `EXTRACTING` | Host triggers post-run git diff, captures modified files manifest, and records final resource metrics. | Max extraction timeout: 15s. |
| `TEARDOWN` | Host terminates container (`docker kill`), purges ephemeral volumes, and releases worker slot. | Max teardown timeout: 5s. |
| `TERMINATED` | Container and ephemeral storage destroyed. Final run manifest marked `completed`. | Terminal state. |
| `ERRORED` | Automatic diagnostic collection (`docker inspect`, memory stats, dmesg) followed by forced teardown. | Terminal state. |

---

## 3. Local Worker Pool & Concurrency Management

### 3.1 Adaptive Concurrency Formula

To prevent developer machine lockup during massive parallel benchmark runs, maximum concurrency $N_{\text{max}}$ is dynamically calculated at runtime:

$$N_{\text{max}} = \max\left(1, \min\left(C_{\text{host}} - 1, \left\lfloor \frac{M_{\text{free\_GB}}}{2.5} \right\rfloor \right)\right)$$

Where:
- $C_{\text{host}}$ is the total number of physical/logical CPU cores (`navigator.hardwareConcurrency` / `os.cpus().length`).
- $M_{\text{free\_GB}}$ is the total host RAM in Gigabytes minus 4GB reserved for host OS and IDE.
- Each container is allocated an upper ceiling of **2.0 vCPUs** and **2.0 GB RAM**.

### 3.2 Dynamic Pool Architecture

```
+-----------------------------------------------------------------------------------+
|                             Container Pool Controller                             |
|                                                                                   |
|  Configuration:                                                                   |
|  - Max Concurrency: 4 slots                                                       |
|  - Idle Timeout: 30s                                                              |
|  - Daemon Throttling: 100ms startup jitter                                        |
+-----------------------------------------------------------------------------------+
                                         |
     +-----------------+-----------------+-----------------+-----------------+
     |                 |                 |                 |                 |
     v                 v                 v                 v                 v
+---------+       +---------+       +---------+       +---------+       +---------+
| Worker  |       | Worker  |       | Worker  |       | Worker  |       | Waiting |
| Slot 1  |       | Slot 2  |       | Slot 3  |       | Slot 4  |       | Queue   |
| (Run A) |       | (Run B) |       | (Run C) |       | (Run D) |       | (Run E) |
+---------+       +---------+       +---------+       +---------+       +---------+
```

### 3.3 Daemon Lock Contention Avoidance
Parallel `docker run` invocations can cause socket contention in the Docker Desktop daemon on macOS. The pool controller introduces a **150ms startup jitter** between consecutive container creations to ensure serialization of daemon initialization hooks.

---

## 4. Strict Resource Governance & Isolation Caps

Every container is launched with strict, immutable cgroups v2 resource boundaries:

```bash
docker create \
  --name "sb-run-${RUN_ID}" \
  --user 1000:1000 \
  --cpus "2.000" \
  --cpu-shares 1024 \
  --memory "2048m" \
  --memory-swap "2048m" \
  --memory-reservation "1536m" \
  --oom-kill-disable=false \
  --pids-limit 256 \
  --storage-opt size=10G \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  --cap-add CHOWN \
  --cap-add DAC_OVERRIDE \
  --cap-add SETUID \
  --cap-add SETGID \
  ghcr.io/skill-benchmarks/sandbox-base:latest
```

### 4.1 Resource Enforcement Details

| Resource Dimension | Parameter Value | Enforcement Mechanism & Rationale |
|---|---|---|
| **CPU Core Limit** | `--cpus 2.0` | Linux CFS (Completely Fair Scheduler) quota (`--cpu-quota=200000 --cpu-period=100000`). Prevents single test runs from starving other benchmark workers. |
| **CPU Shares** | `--cpu-shares 1024` | Equal scheduling priority among active benchmark containers. |
| **Memory Limit** | `--memory 2048m` | Hard physical memory ceiling. Exceeding triggers Linux kernel OOM killer. |
| **Memory Swap** | `--memory-swap 2048m` | Setting swap equal to memory disables disk swapping, eliminating disk thrashing during memory spikes. |
| **OOM Killer** | `--oom-kill-disable=false` | If an agent executes an out-of-memory script, the container process is terminated immediately rather than hanging. |
| **Process Count (PIDs)** | `--pids-limit 256` | Prevents fork bombs or recursive subprocess leaks from crashing the host kernel. |
| **Storage Quota** | `--storage-opt size=10G` | Protects host SSD from runaway file write loops or multi-gigabyte log generation. |

---

## 5. Network Isolation Modes

The orchestrator supports three distinct network isolation modes depending on the benchmark scenario category:

```
+-----------------------------------------------------------------------------------+
|                             Network Isolation Modes                               |
+-----------------------------------------------------------------------------------+
|  1. OFFLINE (Default)                                                             |
|     Flag: --network none                                                          |
|     - Absolute isolation; no outbound IP routing or DNS resolution.              |
|     - Used for algorithmic, refactoring, bug-fixing, and logic benchmark suites.  |
|                                                                                   |
|  2. ISOLATED BRIDGE (Mocked Services)                                             |
|     Flag: --network sb-bridge-isolated                                            |
|     - Custom bridge network with internal DNS resolver.                           |
|     - Container communicates exclusively with local mock API containers          |
|       (e.g., mock GitHub API, mock Stripe server). Egress to WAN is firewalled.   |
|                                                                                   |
|  3. CACHING PROXY (Deterministic Package Installs)                                |
|     Flag: --network sb-bridge-proxied                                             |
|     - Outbound HTTP/HTTPS routed through host-side caching proxy (Verdaccio/devpi)|
|     - Guarantees deterministic package resolution without external latency drift. |
+-----------------------------------------------------------------------------------+
```

---

## 6. TypeScript Orchestration Engine Interfaces

The local orchestration engine is implemented in TypeScript (executed via Bun). The following type definitions govern container pooling and lifecycle interactions:

```typescript
/**
 * Configuration options for spawning a benchmark container.
 */
export interface ContainerLaunchConfig {
  readonly runId: string;
  readonly scenarioId: string;
  readonly imageTag: string;
  readonly resourceLimits: {
    readonly cpus: number; // e.g. 2.0
    readonly memoryMb: number; // e.g. 2048
    readonly pidsLimit: number; // e.g. 256
  };
  readonly networkMode: "none" | "sb-bridge-isolated" | "sb-bridge-proxied";
  readonly workspaceVolumeName: string;
  readonly artifactHostPath: string;
  readonly environment: Record<string, string>;
  readonly timeouts: {
    readonly commandTimeoutMs: number;
    readonly turnTimeoutMs: number;
    readonly totalScenarioTimeoutMs: number;
  };
}

/**
 * Result of a single tool execution inside the container.
 */
export interface ContainerExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly executionTimeMs: number;
  readonly peakMemoryBytes: number;
  readonly timedOut: boolean;
  readonly oomKilled: boolean;
}

/**
 * Handle to an active container instance.
 */
export interface IContainerInstance {
  readonly containerId: string;
  readonly runId: string;
  readonly state: "CREATING" | "HYDRATING" | "READY" | "EXECUTING" | "EXTRACTING" | "TEARDOWN" | "TERMINATED" | "ERRORED";
  
  /**
   * Execute a bash command inside the container with real-time streaming hooks.
   */
  executeCommand(
    command: string,
    options?: {
      readonly cwd?: string;
      readonly timeoutMs?: number;
      readonly onStdoutChunk?: (chunk: Uint8Array) => void;
      readonly onStderrChunk?: (chunk: Uint8Array) => void;
    }
  ): Promise<ContainerExecResult>;

  /**
   * Read raw file content from the container workspace.
   */
  readFile(path: string): Promise<Uint8Array>;

  /**
   * Write raw file content into the container workspace.
   */
  writeFile(path: string, content: Uint8Array | string): Promise<void>;

  /**
   * Capture a Git diff against the initial baseline commit.
   */
  extractGitDiff(): Promise<string>;

  /**
   * Forcefully terminate and purge container resources.
   */
  teardown(): Promise<void>;
}

/**
 * Container Pool Manager interface.
 */
export interface IContainerPoolManager {
  readonly activeCount: number;
  readonly queuedCount: number;
  readonly maxConcurrency: number;

  /**
   * Acquire an initialized container instance for a benchmark run.
   */
  acquire(config: ContainerLaunchConfig): Promise<IContainerInstance>;

  /**
   * Release and teardown a container instance.
   */
  release(instance: IContainerInstance): Promise<void>;

  /**
   * Purge all active containers and ephemeral volumes on global SIGINT / shutdown.
   */
  drain(): Promise<void>;
}
```

---

## 7. Graceful Teardown & Signal Handling Protocol

When a run completes, times out, or receives an interrupt signal (`SIGINT`/`SIGTERM`), the orchestrator guarantees zero orphaned containers via the following protocol:

```
[ Stop Signal / Teardown Trigger ]
               |
               v
1. Send SIGTERM to container main process (grace period: 2000ms)
               |
               +---> If still alive after 2s: Send SIGKILL (docker kill)
               |
2. Extract remaining log buffers from Docker multiplex stream
               |
3. Remove container instance (`docker rm -f sb-run-<run-id>`)
               |
4. Delete ephemeral workspace named volume (`docker volume rm sb-vol-<run-id>`)
               |
5. Release concurrency slot in ContainerPoolManager
```

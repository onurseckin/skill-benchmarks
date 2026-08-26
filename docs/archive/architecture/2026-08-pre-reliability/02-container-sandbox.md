# Chapter 02: Container Sandboxing & Resource Isolation

[← Previous: 01. System Overview](01-system-overview.md) | [Architecture Index](README.md) | [Next: 03. Frontier LLM Provider Adapters →](03-provider-adapters.md)

---

## 1. Container Sandbox Architecture & Lifecycle

To ensure 100% reproducible, untainted, and secure evaluation of LLM agent code executions, **Skill-Benchmarks** encapsulates every scenario within dedicated, ephemeral Docker containers governed by the Container Pool Manager in [`src/infrastructure/container/pool.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/infrastructure/container/pool.ts).

### 1.1 Finite State Machine (FSM) Lifecycle

Container lifecycle transitions follow a deterministic state machine managed by [`src/infrastructure/container/state-machine.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/infrastructure/container/state-machine.ts):

```
                     ┌────────────────────────┐
                     │     PROVISIONING       │ ◄── docker run / create
                     └───────────┬────────────┘
                                 │ healthcheck passes
                                 ▼
                     ┌────────────────────────┐
          ┌────────► │         IDLE           │ ◄── warm-pool standby
          │          └───────────┬────────────┘
          │                      │ checkoutLease()
          │                      ▼
          │          ┌────────────────────────┐
          │          │        LEASED          │ ──► active task execution
          │          └───────────┬────────────┘
          │                      │ releaseLease() / recycle
          │                      ▼
          │          ┌────────────────────────┐
          └───────── │        DRAINING        │ ──► workspace scrub & reset
          (reusable) └───────────┬────────────┘
                                 │ max_cycles exceeded / unhealthy
                                 ▼
                     ┌────────────────────────┐
                     │       TERMINATED       │ ──► docker rm -f & unmount
                     └────────────────────────┘
```

### 1.2 State Transition Matrix

| Current State  | Event / Trigger           | Target State | Action Performed                                               |
| :------------- | :------------------------ | :----------- | :------------------------------------------------------------- |
| `PROVISIONING` | `HEALTHCHECK_OK`          | `IDLE`       | Container verified, cgroups attached, added to warm pool.      |
| `PROVISIONING` | `TIMEOUT / ERROR`         | `TERMINATED` | Container killed, resource handles cleaned, error logged.      |
| `IDLE`         | `CHECKOUT_LEASE`          | `LEASED`     | Workspace volume bound, lease token issued, telemetry started. |
| `LEASED`       | `TASK_COMPLETE`           | `DRAINING`   | Telemetry finalized, workspace diff extracted.                 |
| `LEASED`       | `TIMEOUT / CRASH`         | `DRAINING`   | Process tree killed (`SIGKILL`), crash logs preserved.         |
| `DRAINING`     | `SCRUB_OK (cycles < max)` | `IDLE`       | Ephemeral mounts cleared, container reset for next lease.      |
| `DRAINING`     | `EXPIRED / DIRTY`         | `TERMINATED` | Docker container destroyed, temporary directories deleted.     |

---

## 2. Workspace Isolation & Ephemeral Volume Management

Each benchmark scenario runs inside an isolated Copy-on-Write (CoW) workspace directory created by [`src/infrastructure/workspace/hydration.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/infrastructure/workspace/hydration.ts).

```
+-----------------------------------------------------------------------------------+
| HOST SYSTEM FILESYSTEM                                                            |
|                                                                                   |
|  /tmp/benchmarks/workspaces/ws-<uuid>/                                             |
|   ├── .baseline-fingerprint.json       (Baseline SHA-256 tree index)              |
|   ├── src/                             (Target codebase files)                    |
|   ├── tests/                           (Read-only or mutable test specs)          |
|   └── output/                          (Execution artifacts)                      |
|          │                                                                        |
|          │ Docker Volume Mount: -v /tmp/benchmarks/workspaces/ws-<uuid>:/workspace|
|          ▼                                                                        |
|  DOCKER CONTAINER (/workspace)                                                    |
|   ├── Read-Only System Rootfs (/bin, /usr, /lib)                                  |
|   ├── Ephemeral CoW Overlay on /workspace (non-root execution `agent:agent`)     |
|   └── Restricted /tmp (tmpfs, 512MB limit, noexec)                                |
+-----------------------------------------------------------------------------------+
```

### 2.1 Hydration & Fingerprinting Flow

1. **Tarball Unpack**: Baseline scenario assets are uncompressed into an ephemeral host directory using [`src/infrastructure/workspace/tar.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/infrastructure/workspace/tar.ts).
2. **SHA-256 Baseline Fingerprinting**: Every file path, size, permissions, and cryptographic hash are indexed in memory ([`src/infrastructure/workspace/fingerprint.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/infrastructure/workspace/fingerprint.ts)).
3. **Execution Mutation**: Agent tools modify, create, or delete workspace files via container exec commands.
4. **Differential State Extraction**: Upon completion, [`src/infrastructure/workspace/diff.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/infrastructure/workspace/diff.ts) computes the exact patch diff, identifying created, modified, and removed files without scanning external host directories.

---

## 3. Linux cgroups v2 Resource Accounting & Telemetry

Resource consumption is tracked at sub-second granularity through Linux cgroups v2 controllers via [`src/infrastructure/telemetry/resource-profiler.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/infrastructure/telemetry/resource-profiler.ts).

### 3.1 Kernel Telemetry Metrics

```
+-----------------------------------------------------------------------------------+
| CGROUPS V2 SUBSYSTEMS & TELEMETRY SAMPLING                                        |
+-----------------------------------------------------------------------------------+
| CPU CONTROLLER (/sys/fs/cgroup/system.slice/docker-<id>.scope/cpu.stat)           |
|   • usage_usec: Total CPU execution time in microseconds                          |
|   • user_usec / system_usec: Breakdown of user vs kernel execution                |
|   • nr_throttled / throttled_usec: Throttling events due to quota saturation      |
+-----------------------------------------------------------------------------------+
| MEMORY CONTROLLER (/sys/fs/cgroup/system.slice/docker-<id>.scope/memory.current)  |
|   • memory.current: Real-time resident set size (RSS) + cache in bytes           |
|   • memory.peak: Maximum memory water-mark reached during execution               |
|   • memory.events (oom_kill / oom): Count of Out-Of-Memory termination events     |
+-----------------------------------------------------------------------------------+
| IO CONTROLLER (/sys/fs/cgroup/system.slice/docker-<id>.scope/io.stat)             |
|   • rbytes / wbytes: Cumulative read/write byte counts                            |
|   • rios / wios: Cumulative I/O operations (IOPS)                                 |
+-----------------------------------------------------------------------------------+
```

### 3.2 Host Security & Quota Enforcement Flags

Containers are spawned using hardened Docker CLI parameters generated by [`src/infrastructure/container/docker-args.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/infrastructure/container/docker-args.ts):

- `--cpus="2.0"`: Limits task execution to 2.0 logical CPU cores.
- `--memory="4g"`: Caps maximum RAM consumption at 4.0 GiB (hard limit).
- `--memory-swap="4g"`: Disables swap allocation to prevent disk-thrashing OOM escapes.
- `--pids-limit="256"`: Prevents fork-bomb vulnerabilities.
- `--security-opt="no-new-privileges:true"`: Restricts privilege escalation via SUID binaries.
- `--cap-drop="ALL"` & `--cap-add="CHOWN,SETUID,SETGID"`: Enforces minimal POSIX capabilities.
- `--read-only`: Mounts root container filesystem as read-only.

---

## 4. Garbage Collection, Leak Prevention & Process Reaping

Long-running agent benchmarks risk accumulating orphaned processes, stalled socket connections, and dangling container instances. Skill-Benchmarks implements multi-tiered GC mechanisms:

```
+-----------------------------------------------------------------------------------+
|                           GARBAGE COLLECTION PIPELINE                             |
|                                                                                   |
|  1. IN-CONTAINER PROCESS REAPER (Tini / dumb-init PID 1)                          |
|     Subreaper automatically adopts orphaned child processes and propagates         |
|     SIGTERM / SIGKILL across the full process tree.                               |
|                                                                                   |
|  2. TASK-LEVEL TIMEOUT ENFORCER (AbortController)                                 |
|     Hard deadline timer sends SIGTERM. If processes remain after 5000ms grace      |
|     window, escalates to SIGKILL.                                                 |
|                                                                                   |
|  3. BACKGROUND CONTAINER REAPER (src/infrastructure/container/gc.ts)              |
|     Periodic sweep identifies containers with labels `benchmark.managed=true`     |
|     whose parent host runner has disconnected or whose lease has lapsed.          |
+-----------------------------------------------------------------------------------+
```

---

[← Previous: 01. System Overview](01-system-overview.md) | [Architecture Index](README.md) | [Next: 03. Frontier LLM Provider Adapters →](03-provider-adapters.md)

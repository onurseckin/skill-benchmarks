# 03. Workspace Isolation, Storage Strategy, and State Diffing

## 1. Executive Overview & Isolation Requirements

A core requirement of the `skill-benchmarks` platform is **hermetic reproducibility**:
1. **Zero Cross-Contamination**: Benchmark run $R_B$ must never inherit modified files, cached node_modules, temp files, or environment variables from run $R_A$.
2. **Deterministic Baseline**: Every execution of a scenario starts from an identical byte-for-byte file tree snapshot.
3. **High-Performance Filesystem Operations**: Fast file reads, writes, and git diff generation without virtiofs/FUSE disk bottlenecks on macOS.
4. **Structured Post-Run State Extraction**: Capturing both a standard unified Git diff (`git.diff`) and a structured metadata diff manifest (`diff-manifest.json`) recording all filesystem changes made by the agent.

---

## 2. Storage Strategy Evaluation & Hybrid Architecture

### 2.1 Storage Mechanism Comparison

| Storage Mechanism | macOS Performance | Linux Performance | Isolation Level | Persistence / Diffability | Verdict |
|---|---|---|---|---|---|
| **Direct Host Bind Mount** (`-v /host/path:/workspace`) | Medium-Low (VirtioFS bridge overhead on small I/O operations) | Maximum (Native direct inode access) | Medium (Host permissions and umask leak into container) | High (Directly visible on host) | Suboptimal for compilation and intensive package resolution |
| **Pure Tmpfs (RAM Disk)** (`--tmpfs /workspace:rw,size=2G`) | Maximum (In-memory) | Maximum (In-memory) | Maximum (Destroyed on container exit) | Low (Crash or OOM destroys state before diff extraction) | Risky for failure forensics |
| **Ephemeral Named Volume** (`-v sb-vol-<id>:/workspace`) | Maximum (Native ext4 in Linux VM) | Maximum (Native Docker rootfs overlay) | Maximum (Completely isolated per run) | High (Persists until explicit orchestrator teardown) | **SELECTED for `/workspace`** |
| **Direct Host Artifact Mount** (`-v /host/runs/<id>:/artifacts:rw`) | High (Sequential append log writes) | Maximum | High | Maximum (Real-time telemetry streaming to host) | **SELECTED for `/artifacts`** |

### 2.2 The Hybrid Storage Architecture

The orchestrator combines **Ephemeral Named Volumes** for active workspace code execution with **Direct Host Bind Mounts** for telemetry streaming and artifact capture:

```
+-----------------------------------------------------------------------------------+
|                            Hybrid Storage Architecture                            |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|   HOST FILESYSTEM (Developer Machine)                                             |
|   /Users/developer/repos/skill-benchmarks/                                        |
|   ├── scenarios/bugfix-01/fixture/  --------+ (Read-Only Source Template)         |
|   └── .benchmarks/runs/<run-id>/    <----+  |                                     |
|       ├── events.jsonl                   |  | (Direct Bind Mount: /artifacts)     |
|       ├── raw.log                        |  |                                     |
|       ├── git.diff                       |  |                                     |
|       └── diff-manifest.json             |  |                                     |
|                                          |  |                                     |
+------------------------------------------|--|-------------------------------------+
                                           |  |
                                 Bind Mount|  | tar Stream Hydration
                                           v  v
+-----------------------------------------------------------------------------------+
|   DOCKER SANDBOX CONTAINER (`sb-run-<run-id>`)                                     |
|                                                                                   |
|   +---------------------------------------+  +---------------------------------+  |
|   |         /artifacts (Bind Mount)       |  |      /workspace (Named Volume)  |  |
|   |  - Real-time event logging            |  |  - High-speed native filesystem |  |
|   |  - Process stdout/stderr capture      |  |  - Extracted scenario files     |  |
|   |  - Post-run diff outputs              |  |  - Git baseline repo (.git)     |  |
|   |  - Diagnostics on error               |  |  - Ephemeral node_modules/venv  |  |
|   +---------------------------------------+  +---------------------------------+  |
|                                                              |                    |
+--------------------------------------------------------------|--------------------+
                                                               v
                                                +---------------------------------+
                                                | Docker Volume: sb-vol-<run-id>  |
                                                | (Purged on Container Teardown)  |
                                                +---------------------------------+
```

---

## 3. Fixture Hydration & Baseline Tagging Pipeline

To ensure sub-second workspace initialization without host permission friction, fixture hydration follows a deterministic four-step pipeline:

```
[ Step 1: Volume & Container Creation ]
  docker volume create sb-vol-<run-id>
  docker create -v sb-vol-<run-id>:/workspace -v /host/runs/<run-id>:/artifacts ...

[ Step 2: Fixture Archive Streaming ]
  tar -cf - -C <scenario_fixture_dir> . | docker cp - sb-run-<run-id>:/workspace/

[ Step 3: Permissions & Ownership Normalization ]
  docker exec -u root sb-run-<run-id> chown -R sandbox:sandbox /workspace

[ Step 4: Baseline Git Repository Initialization ]
  docker exec -u sandbox sb-run-<run-id> bash -c "
    cd /workspace && \
    if [ ! -d .git ]; then
      git init && \
      git add -A && \
      git commit -m 'Initial scenario baseline' && \
      git tag baseline
    else
      git checkout -B benchmark-run && \
      git tag -f baseline
    fi
  "
```

### 3.1 Pre-Run File Tree Fingerprinting
Before handing control to the agent, the host captures a cryptographic SHA-256 manifest of all files in the workspace:

```json
{
  "runId": "run-20260824-001",
  "scenarioId": "bugfix-auth-token-leak",
  "timestamp": "2026-08-24T08:00:00.000Z",
  "fileCount": 14,
  "files": {
    "src/auth/jwt.ts": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "src/index.ts": "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    "package.json": "8843d7f92416211de9ebb963ff4ce28125932878",
    "tests/auth.test.ts": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a"
  }
}
```

---

## 4. Post-Run Diff Extraction & Modification Inventory

Once the agent signals task completion or reaches its maximum turns, the extraction engine extracts both a raw unified diff and a structured JSON modification inventory.

### 4.1 Git Diff Generation Procedure

To capture both modified files and newly created untracked files:

```bash
docker exec -u sandbox sb-run-<run-id> bash -c "
  cd /workspace && \
  git add --intent-to-add . && \
  git diff --binary --full-index baseline
" > /host/runs/<run-id>/git.diff
```

### 4.2 Structured Diff Manifest (`diff-manifest.json`)

The host parses the diff output and filesystem status into a typed JSON manifest:

```typescript
export interface DiffManifest {
  readonly runId: string;
  readonly scenarioId: string;
  readonly baseCommitSha: string;
  readonly generatedAt: string;
  readonly summary: {
    readonly filesChanged: number;
    readonly insertions: number;
    readonly deletions: number;
    readonly netLines: number;
    readonly totalHunks: number;
    readonly binaryFilesCount: number;
  };
  readonly fileModifications: ReadonlyArray<{
    readonly path: string;
    readonly changeType: "added" | "modified" | "deleted" | "renamed" | "permission_change";
    readonly oldPath?: string;
    readonly oldMode?: string;
    readonly newMode?: string;
    readonly insertions: number;
    readonly deletions: number;
    readonly isBinary: boolean;
    readonly sha256Before?: string;
    readonly sha256After?: string;
  }>;
}
```

---

## 5. Host-Container Directory Structure & Permissions

### 5.1 Directory Layout Hierarchy

```
<skill-benchmarks-repo>/
├── scenarios/
│   └── <category>/
│       └── <scenario-id>/
│           ├── scenario.yaml             # Scenario definition & evaluation rules
│           └── fixture/                  # Starter codebase template
│               ├── package.json
│               ├── src/
│               └── tests/
└── .benchmarks/
    ├── benchmarks.sqlite                 # Aggregated metrics database
    └── runs/
        └── <run-id>/                     # Host-mounted artifact directory
            ├── manifest.json             # Run metadata
            ├── events.jsonl              # Real-time event stream
            ├── raw.log                   # Concatenated raw stdout/stderr
            ├── pre-run-manifest.json     # Baseline SHA-256 hashes
            ├── git.diff                  # Unified diff patch
            ├── diff-manifest.json        # Structured modification summary
            ├── metrics.json              # Aggregated telemetry summary
            └── evaluation.json           # Evaluation scores & judge reports
```

### 5.2 Permissions Reconciliation Policy

On Linux host systems, bind-mounting directories can create file ownership issues if the container user (`UID 1000`) differs from the host developer. The benchmark harness reconciles permissions via:
1. **Container User Matching**: The container runs under `sandbox (UID 1000, GID 1000)`.
2. **Artifact Directory Ownership**: Host creates `.benchmarks/runs/<run-id>/` before container launch with `0777` permissions, allowing the container's non-root `sandbox` user to write telemetry streams without permission denials.
3. **Strict Non-Root Guarantee**: The agent inside the container is never granted `sudo` or root capabilities, preventing it from tampering with host-level filesystems.

---

## 6. Teardown & Garbage Collection Pipeline

To prevent local disk space exhaustion over hundreds of benchmark runs, the orchestrator implements a multi-stage cleanup and garbage collection protocol.

```
+-----------------------------------------------------------------------------------+
|                        Workspace Teardown Lifecycle Flow                          |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
                         +-------------------------------+
                         |   Post-Run Extraction Done    |
                         +-------------------------------+
                                         |
                                         v
                         +-------------------------------+
                         | 1. Stop & Remove Container    | (docker rm -f sb-run-<id>)
                         +-------------------------------+
                                         |
                                         v
                         +-------------------------------+
                         | 2. Purge Ephemeral Volume     | (docker volume rm sb-vol-<id>)
                         +-------------------------------+
                                         |
                                         v
                         +-------------------------------+
                         | 3. Verify Host Artifacts Sync | (fsync on .benchmarks/runs/<id>)
                         +-------------------------------+
                                         |
                                         v
                         +-------------------------------+
                         | 4. Slot Released to Pool      |
                         +-------------------------------+
```

### 6.1 Orphaned Resource Garbage Collection

If a benchmark process is terminated abruptly (`SIGKILL` or system reboot), ephemeral volumes or stopped containers may remain on disk. The harness CLI provides an automated garbage collection command:

```bash
bun run gc:containers
```

Which executes:
1. Pruning stale containers labeled with `io.skill-benchmarks.managed=true` created more than 1 hour ago.
2. Pruning dangling named volumes labeled with `io.skill-benchmarks.volume=workspace`.

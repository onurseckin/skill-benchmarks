# 01. Docker Base Image Specification & Dual-Runtime Architecture

## 1. Executive Overview & Design Philosophy

The `skill-benchmarks` infrastructure requires a deterministic, lightweight, and high-performance execution sandbox where LLM agent skills run under strictly equal, reproducible conditions.

Benchmarking skills across diverse developer workstations (macOS Apple Silicon, Linux x86_64/ARM64, Windows WSL2) introduces host environment variance—divergent glibc versions, shell configurations, ambient environment variables, and pre-installed binary tools. Containerized execution eliminates this variance by guaranteeing:

1. **Deterministic Execution**: Identical binary versions, tool paths, standard library implementations, and execution sandboxes regardless of the host machine.
2. **Dual-Runtime High Velocity**: Native, high-performance support for both JavaScript/TypeScript (Node.js LTS + Bun) and Python (Python 3.12+ + `uv`), utilizing the fastest package managers and runtime engines available.
3. **Hermetic Security & Safety**: Complete isolation from the host filesystem, non-root execution, privilege dropping, and restricted capabilities to prevent untrusted agent actions from affecting the host.
4. **Minimal Startup Latency**: A slim image footprint (~350MB compressed, <900MB uncompressed) optimized for cold startup in < 1.5 seconds and instant tool dispatch.

---

## 2. Base Operating System Selection

### 2.1 OS Evaluation Matrix

| Distribution | Base Size | C Library | Compatibility | Package Ecosystem | Verdict |
|---|---|---|---|---|---|
| **Debian Bookworm Slim** (`debian:bookworm-slim`) | **~74 MB** | **glibc** | **Maximum (Universal wheels, Bun native bindings, Node addons)** | **Apt (extensive, stable, well-maintained)** | **SELECTED (Optimal balance of size, glibc compatibility, and stability)** |
| **Alpine Linux** (`alpine:latest`) | ~7 MB | musl | Low (Requires musl wheels, Bun incompatibilities, segfault risks on native binaries) | Apk (minimal, frequent ABI mismatch) | Rejected (musl breaks standard Python wheels and Bun native bindings) |
| **Ubuntu Minimal** (`ubuntu:24.04`) | ~110 MB | glibc | Maximum | Apt + Snap (unnecessary bloat, slower image build) | Rejected (Heavier than Debian-slim with no added benefits) |
| **Distroless / Scratch** | ~2-20 MB | None/glibc | None (No interactive shell, no CLI tools, impossible to run agent bash tools) | None | Rejected (Agent benchmarks require standard CLI tools: bash, git, jq) |

### 2.2 Why Debian Bookworm Slim?
- **Universal glibc Compatibility**: Python binary wheels on PyPI (PEP 600 `manylinux_2_34`), Bun binary distributions, Node.js pre-compiled binaries, and Rust/C++ native addons compile and execute without musl ABI friction.
- **Predictable Tooling**: Well-tested standard utilities (`coreutils`, `bash 5.2+`, `git 2.39+`, `tar`, `grep`, `sed`, `awk`).
- **Clean Attack Surface**: Minimal pre-installed packages without systemd or desktop daemon overhead.

---

## 3. Dual-Runtime Stack Architecture

Modern agent skills predominantly operate in two primary ecosystems: **JavaScript/TypeScript** and **Python**. The sandbox provides a first-class, optimized dual-runtime stack.

```
+-----------------------------------------------------------------------------------+
|                       Sandbox Container Runtime Architecture                      |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                             Non-Root User: sandbox                          |  |
|  |                UID: 1000 | GID: 1000 | Home: /home/sandbox                  |  |
|  +-----------------------------------------------------------------------------+  |
|                                         |                                         |
|         +-------------------------------+-------------------------------+         |
|         |                                                               |         |
|         v                                                               v         |
|  +-----------------------------+                         +-----------------------------+
|  |     JS / TS Runtime Stack   |                         |     Python Runtime Stack    |
|  |  - Node.js v22.x LTS        |                         |  - Python 3.12+ (CPython)   |
|  |  - Bun v1.2+ (Fast runtime) |                         |  - Astral uv (Ultra-fast)   |
|  |  - pnpm / npm / corepack    |                         |  - pip / venv / setuptools  |
|  +-----------------------------+                         +-----------------------------+
|         |                                                               |         |
|         +-------------------------------+-------------------------------+         |
|                                         |                                         |
|                                         v                                         |
|  +-----------------------------------------------------------------------------+  |
|  |                         Strategic CLI Toolkit (C / Rust)                    |  |
|  |   git (2.39+)   |   ripgrep (rg)   |   fd-find (fd)   |   jq (1.6+)         |  |
|  |   curl / wget   |   tar / gzip     |   make / gcc     |   bash (5.2+)       |  |
|  +-----------------------------------------------------------------------------+  |
|                                         |                                         |
|                                         v                                         |
|  +-----------------------------------------------------------------------------+  |
|  |                     Debian 12 Bookworm Slim Base Layer                      |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### 3.1 JavaScript / TypeScript Runtime Specification
- **Node.js LTS (v22.x)**: Official active LTS release providing maximum compatibility with legacy npm scripts, standard libraries, and testing frameworks (Jest, Vitest, Mocha).
- **Bun (v1.2+)**:
  - Primary execution engine for TypeScript scripts without transpile steps (`bun run script.ts`).
  - High-performance package manager (`bun install` is 10x-25x faster than npm/pnpm).
  - Native high-speed test runner (`bun test`).
- **Package Manager Caching**: Dedicated cache directories pre-configured at `/home/sandbox/.bun/install/cache` and `/home/sandbox/.npm` with proper ownership.

### 3.2 Python Runtime Specification
- **Python (3.12+)**: Modern CPython runtime with full standard library support, typing enhancements, and sub-interpreter performance optimizations.
- **Astral `uv` (Latest Stable)**:
  - Statically linked, Rust-based package installer and resolver.
  - Sub-millisecond virtualenv creation (`uv venv .venv`).
  - Ultra-fast dependency resolution and installation (`uv pip install -r requirements.txt`).
  - Standalone script runner (`uv run script.py`).
- **pip & venv**: Standard fallbacks available in system PATH.
- **Global Package Cache**: Cache directory located at `/home/sandbox/.cache/uv`.

---

## 4. Strategic CLI Toolkit

The base image includes a curated set of high-performance developer utilities required by agents to explore, inspect, mutate, and test codebases.

| Tool | Binary Path | Version / Source | Primary Role in Benchmark Scenarios |
|---|---|---|---|
| `bash` | `/bin/bash` | 5.2+ (Debian) | Default interactive shell with programmable completion and job control. |
| `git` | `/usr/bin/git` | 2.39+ (Debian) | Version control, workspace baseline tagging, diff generation (`git diff`). |
| `ripgrep` | `/usr/bin/rg` | Latest Rust binary | Ultra-fast regex and text searching across large multi-file codebases. |
| `fd-find` | `/usr/bin/fd` | Latest Rust binary | High-speed directory tree traversal and file pattern discovery. |
| `jq` | `/usr/bin/jq` | 1.6+ (Debian) | JSON parsing, transformation, and query extraction in CLI pipelines. |
| `curl` / `wget` | `/usr/bin/curl` | Latest (Debian) | HTTP payload inspection, network retrieval, API interactions. |
| `tar` / `gzip` / `unzip` | `/bin/tar` | Coreutils / Debian | Fixture decompression and workspace archive extraction. |
| `make` / `build-essential` | `/usr/bin/make` | Debian build tools | Building native extensions, C bindings, and running Makefile targets. |
| `procps` / `psmisc` | `/bin/ps`, `/usr/bin/killall` | Debian | Process tree inspection, PID tracking, and graceful signal dispatch. |
| `ca-certificates` | `/etc/ssl/certs` | Debian | SSL/TLS certificate verification for secure package downloads. |

---

## 5. Multi-Stage Dockerfile Specification

To minimize final image size, reduce security vulnerabilities, and ensure cache efficiency during builds, the image uses a multi-stage build pipeline.

```dockerfile
# syntax=docker/dockerfile:1.7-labs

# ==============================================================================
# Stage 1: Tool & Binary Downloader Stage
# ==============================================================================
FROM debian:bookworm-slim AS binary-builder

ARG TARGETPLATFORM
ARG BUN_VERSION=1.2.4
ARG UV_VERSION=0.6.3

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    unzip \
    tar \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /extracted

# Download and extract Bun (platform-aware)
RUN case "${TARGETPLATFORM}" in \
      "linux/amd64") BUN_ARCH="x64" ;; \
      "linux/arm64") BUN_ARCH="aarch64" ;; \
      *) BUN_ARCH="x64" ;; \
    esac && \
    curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${BUN_ARCH}.zip" -o /tmp/bun.zip && \
    unzip -q /tmp/bun.zip -d /tmp/bun-dist && \
    mkdir -p /extracted/bin && \
    mv /tmp/bun-dist/bun-linux-${BUN_ARCH}/bun /extracted/bin/bun && \
    chmod +x /extracted/bin/bun && \
    ln -s /extracted/bin/bun /extracted/bin/bunx

# Download and extract Astral uv (platform-aware)
RUN case "${TARGETPLATFORM}" in \
      "linux/amd64") UV_ARCH="x86_64-unknown-linux-gnu" ;; \
      "linux/arm64") UV_ARCH="aarch64-unknown-linux-gnu" ;; \
      *) UV_ARCH="x86_64-unknown-linux-gnu" ;; \
    esac && \
    curl -fsSL "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${UV_ARCH}.tar.gz" -o /tmp/uv.tar.gz && \
    tar -xzf /tmp/uv.tar.gz -C /tmp && \
    mv /tmp/uv-${UV_ARCH}/uv /extracted/bin/uv && \
    mv /tmp/uv-${UV_ARCH}/uvx /extracted/bin/uvx && \
    chmod +x /extracted/bin/uv /extracted/bin/uvx

# ==============================================================================
# Stage 2: Final Runtime Image
# ==============================================================================
FROM debian:bookworm-slim AS sandbox-base

LABEL maintainer="infrastructure@skill-benchmarks.dev"
LABEL description="Deterministic Dual-Runtime Sandbox for Skill Benchmarking"
LABEL version="1.0.0"

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# 1. Install base OS dependencies, Node.js repository, Python, and CLI utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends \
    bash \
    git \
    nodejs \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    ripgrep \
    fd-find \
    jq \
    tar \
    gzip \
    unzip \
    bzip2 \
    patch \
    make \
    gcc \
    g++ \
    procps \
    psmisc \
    coreutils \
    sed \
    gawk \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && npm install -g pnpm corepack \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# 2. Copy binaries from builder stage
COPY --from=binary-builder /extracted/bin/bun /usr/local/bin/bun
COPY --from=binary-builder /extracted/bin/bunx /usr/local/bin/bunx
COPY --from=binary-builder /extracted/bin/uv /usr/local/bin/uv
COPY --from=binary-builder /extracted/bin/uvx /usr/local/bin/uvx

# 3. Create sandbox non-root user and directories
ARG USERNAME=sandbox
ARG USER_UID=1000
ARG USER_GID=1000

RUN groupadd --gid ${USER_GID} ${USERNAME} \
    && useradd --uid ${USER_UID} --gid ${USER_GID} --create-home --shell /bin/bash ${USERNAME} \
    && mkdir -p /workspace /home/${USERNAME}/.cache /home/${USERNAME}/.npm /home/${USERNAME}/.bun \
    && chown -R ${USERNAME}:${USERNAME} /workspace /home/${USERNAME}

# 4. Configure Git identity for deterministic commits inside sandboxes
USER ${USERNAME}
WORKDIR /home/${USERNAME}

RUN git config --global user.name "Skill Benchmark Sandbox" \
    && git config --global user.email "sandbox@skill-benchmarks.dev" \
    && git config --global init.defaultBranch main \
    && git config --global advice.detachedHead false

# 5. Environment configuration
ENV USER=${USERNAME}
ENV HOME=/home/${USERNAME}
ENV WORKSPACE=/workspace
ENV PATH=/home/${USERNAME}/.local/bin:/usr/local/bin:/usr/bin:/bin

# 6. Copy environment verification script
USER root
COPY --chmod=0755 verify-env.sh /usr/local/bin/verify-env.sh
USER ${USERNAME}

WORKDIR /workspace

# Keep container idle and responsive for incoming exec invocations
CMD ["sleep", "infinity"]
```

---

## 6. Environment Verification Script

To ensure complete runtime integrity during container startup and CI image testing, a dedicated verification script `/usr/local/bin/verify-env.sh` validates all binaries.

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== Skill Benchmarks Sandbox Environment Verification ==="

check_binary() {
    local name="$1"
    local cmd="$2"
    if command -v "${cmd%% *}" >/dev/null 2>&1; then
        local version
        version=$(${cmd} 2>&1 | head -n 1)
        printf "  [✓] %-16s : %s\n" "${name}" "${version}"
    else
        printf "  [✗] %-16s : NOT FOUND\n" "${name}"
        exit 1
    fi
}

check_binary "OS Release" "cat /etc/debian_version"
check_binary "Shell (bash)" "bash --version"
check_binary "Git" "git --version"
check_binary "Node.js" "node --version"
check_binary "npm" "npm --version"
check_binary "pnpm" "pnpm --version"
check_binary "Bun" "bun --version"
check_binary "Python" "python3 --version"
check_binary "uv" "uv --version"
check_binary "ripgrep" "rg --version"
check_binary "fd-find" "fd --version"
check_binary "jq" "jq --version"

echo "=== Non-Root User Verification ==="
printf "  Current User: %s (UID=%s, GID=%s)\n" "$(whoami)" "$(id -u)" "$(id -g)"
if [ "$(id -u)" -eq 0 ]; then
    echo "  [✗] Security Failure: Running as root!"
    exit 1
fi
printf "  Workspace: %s (writable: %s)\n" "/workspace" "$([ -w /workspace ] && echo "YES" || echo "NO")"

echo "=== Environment Verification Passed Successfully ==="
```

---

## 7. Security Hardening & Container Execution Constraints

### 7.1 Security Constraints Specification

When running the container via Docker, the following flags are strictly enforced by the host orchestrator:

```bash
docker run -d \
  --name "sb-run-<run-id>" \
  --user 1000:1000 \
  --security-opt=no-new-privileges:true \
  --cap-drop=ALL \
  --cap-add=CHOWN \
  --cap-add=DAC_OVERRIDE \
  --cap-add=SETUID \
  --cap-add=SETGID \
  --memory=2g \
  --memory-swap=2g \
  --cpus=2.0 \
  --pids-limit=256 \
  --network=none \
  ghcr.io/skill-benchmarks/sandbox-base:latest
```

### 7.2 Rationale for Security Configuration
1. `--security-opt=no-new-privileges:true`: Prevents processes from gaining additional privileges via `setuid` binaries.
2. `--cap-drop=ALL`: Drops all kernel capabilities (e.g. `CAP_NET_RAW`, `CAP_SYS_ADMIN`, `CAP_SYS_PTRACE`), neutralizing kernel exploit vectors.
3. `--pids-limit=256`: Prevents runaway fork bombs from exhausting host process tables.
4. `--network=none`: Eliminates unauthorized external network access during hermetic offline evaluations.

---

## 8. Layer Optimization & Build Caching Strategy

1. **Layer Order Invariance**:
   - `base OS -> system packages -> binary downloads -> user creation -> git config`.
   - Infrequent changes remain at top layers; volatile scripts reside in lower layers.
2. **Package Cache Elimination**:
   - Every `apt-get install` block ends with `rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*` in the same `RUN` step to prevent cache layer pollution.
3. **Multi-Architecture Support**:
   - Fully supports `linux/amd64` and `linux/arm64` (Apple Silicon M1/M2/M3/M4) via Docker Buildx multi-arch manifests.

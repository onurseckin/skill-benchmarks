# Installation & System Prerequisites

[Table of Contents](../README.md) | [Next: Configuration](configuration.md)

This document provides step-by-step instructions for preparing your local workstation or CI runner to execute the Agent Skill Benchmarks platform.

---

## 1. System Requirements

| Component | Minimum Specification | Recommended Specification |
| :--- | :--- | :--- |
| **Operating System** | macOS 13+ (Apple Silicon / Intel) or Linux (Ubuntu 22.04+, Debian 12+, Fedora 38+) | macOS 14+ or Ubuntu 24.04 LTS |
| **CPU Architecture** | x86_64 or ARM64 (Apple Silicon M-series supported natively) | 8+ physical cores for parallel matrix sweeps |
| **RAM** | 8 GB RAM | 32 GB RAM (for high concurrency Docker sandboxes) |
| **Disk Storage** | 10 GB free disk space | 50 GB NVMe SSD for benchmark databases & traces |
| **Runtime** | Bun 1.1.0+ or Bun 1.3.0+ | Bun 1.3.14+ |
| **Container Engine** | Docker Engine 24.0+ with cgroups v2 support | Docker Desktop 4.30+ or native Linux dockerd |

---

## 2. Installing the Bun Runtime

The benchmark platform is built entirely with TypeScript and executed via the ultra-fast Bun runtime.

### macOS & Linux Installation
Execute the official Bun installation script:

```bash
curl -fsSL https://bun.sh/install | bash
```

Verify your installation:

```bash
bun --version
```

Ensure Bun is on your shell's `$PATH`. Add the following to your `~/.zshrc` or `~/.bashrc` if not already present:

```bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
```

---

## 3. Cloning Repository & Installing Dependencies

Clone the skill-benchmarks repository and install required dependencies:

```bash
git clone https://github.com/onurseckin/skill-benchmarks.git
cd skill-benchmarks
bun install
```

The repository includes dependencies for:
- TypeScript type checking and compilation
- SQLite database driver (`bun:sqlite`)
- Terminal styling and ANSI escape formatting
- PTY multiplexing and HTTP/WebSocket server runtimes

---

## 4. Docker & Sandbox Setup

Benchmark scenarios execute untrusted agent commands inside isolated sandboxes. You can run trials using either local process isolation or Docker containers.

### Docker Engine Verification
Verify that Docker is running and accessible without root privileges:

```bash
docker info
```

If running on Linux, ensure your user is added to the `docker` group:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### Pulling Base Sandbox Images
Warm up the local image cache with the standard benchmark evaluation container:

```bash
docker pull node:22-slim
docker pull python:3.11-slim
```

---

## 5. System Health Check & Initial Verification

Verify that all dependencies and source files satisfy platform quality invariants:

```bash
# 1. Verify TypeScript compilation
bun run typecheck

# 2. Verify repository quality gate (0 comments, <= 400 lines per file)
bun run src/scripts/quality-gate.ts

# 3. List available scenarios and skills in the catalog
bun run src/cli/index.ts list --target all
```

Expected output for the list command:

```text
================================================================================
Listing Benchmark Catalog Entities [target: all]
================================================================================

Available Benchmark Scenarios:
  git-worktrees             Git Worktrees Isolation and Cleanup [coding] (medium)
  memory-leak               Memory Leak Investigation and Fix [debugging] (hard)
  react-memoization         React Render Optimization [frontend] (medium)
  sql-injection-fix         SQL Injection Remediation [security] (hard)

Available Skills:
  using-git-worktrees       using-git-worktrees [v1.0.0]
  systematic-debugging      systematic-debugging [v1.0.0]
  react-performance         react-performance [v1.0.0]
  secure-sql-queries        secure-sql-queries [v1.0.0]
```

---

## 6. Troubleshooting Common Issues

### Issue: `bun: command not found`
- Ensure `$HOME/.bun/bin` is included in your active shell's `$PATH`.
- Restart your terminal session or run `source ~/.zshrc`.

### Issue: `Docker daemon not running`
- Start Docker Desktop (macOS) or run `sudo systemctl start docker` (Linux).
- To run benchmarks in lightweight local mode without Docker, pass `--clean-sandbox` or use local fixture paths.

### Issue: TypeScript Typecheck Errors
- Ensure you have executed `bun install` to install all `@types/*` packages.
- Run `bun run typecheck` to inspect exact line annotations.

---

## Next Steps

Now that your workstation is configured and verified, proceed to configuring your environment variables and model API keys:

- [Previous: Table of Contents](../README.md)
- [Next: Environment Configuration & Provider Keys](configuration.md)

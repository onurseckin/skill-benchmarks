# Interactive Shell & Terminal Controls

[Previous: CLI Command Manual](commands.md) | [Table of Contents](../README.md) | [Next: Single Trial Execution](../running-benchmarks/single-trial.md)

This document describes the interactive terminal interface, live execution monitors, real-time telemetry streaming, and keyboard shortcuts provided by the Agent Skill Benchmarks platform.

---

## 1. Overview of Interactive Mode

The interactive terminal shell provides a live dashboard for monitoring running benchmark sweeps, stepping through agent trajectories, inspecting tool inputs/outputs, and managing ongoing evaluations without parsing log files.

To launch the CLI in interactive mode:

```bash
bun run src/cli/index.ts
```

When launched without arguments, the CLI opens the interactive scenario and skill selector.

---

## 2. Interactive Selection Menu

The selection menu allows you to interactively configure benchmark runs:

```text
================================================================================
Agent Skill Benchmarks: Interactive Trial Launcher
================================================================================

Select Benchmark Scenario:
  [x] git-worktrees             Git Worktrees Isolation and Cleanup (coding)
  [ ] memory-leak               Memory Leak Investigation and Fix (debugging)
  [ ] react-memoization         React Render Optimization (frontend)
  [ ] sql-injection-fix         SQL Injection Remediation (security)

Select Skill Manifest:
  [x] using-git-worktrees       using-git-worktrees (v1.0.0)
  [ ] systematic-debugging      systematic-debugging (v1.0.0)
  [ ] react-performance         react-performance (v1.0.0)

Select Target Model:
  [x] claude-3-7-sonnet         Anthropic Claude 3.7 Sonnet
  [ ] gpt-4o                    OpenAI GPT-4o
  [ ] deepseek-reasoner         DeepSeek R1
```

### Menu Controls

| Key | Action |
| :--- | :--- |
| `Up` / `Down` or `k` / `j` | Move selection highlight |
| `Space` | Toggle checkbox item |
| `Enter` | Confirm selection and proceed |
| `Esc` or `q` | Cancel and exit launcher |

---

## 3. Real-Time Execution Monitor

During matrix sweeps and single trials, the terminal displays live progress metrics, per-worker status badges, and resource utilization counters.

```text
================================================================================
Executing Skill Benchmark Matrix: 2 scenario(s) x 2 skill(s) x 2 model(s)
================================================================================

[ACTIVE WORKERS: 4/4]  Progress: [━━━━━━━━━━━━━━━━━━━━────────] 50% (4/8 runs)
Elapsed: 42.1s | Estimated Remaining: 38.4s | Total Spend: $0.48 USD

  [RUNNING] git-worktrees:using-git-worktrees:claude-3-7-sonnet
            Turn 4/15 | Tool: run_command ("git worktree add -b feat-1")
            CPU: 24% | Memory: 142 MB | Cost: $0.062

  [RUNNING] memory-leak:systematic-debugging:gpt-4o
            Turn 7/15 | Tool: read_file ("src/server.ts")
            CPU: 18% | Memory: 198 MB | Cost: $0.081

  [PASS]    git-worktrees:generic-agent:claude-3-7-sonnet (Score: 0.85, 18.2s)
  [FAIL]    memory-leak:generic-agent:gpt-4o (Score: 0.20, 24.1s)
```

---

## 4. Live Event Streaming & Turn Telemetry

When running with `--verbose` or inside the interactive player, every event is emitted in real time:

- **Turn Start / Finish**: Model inference latency, prompt token count, and completion token count
- **Tool Dispatch**: Invoked tool name, argument JSON payload, and sandboxed working directory
- **Tool Execution Result**: Return exit code, stdout/stderr captures, and duration
- **Cgroups Telemetry**: Real-time CPU throttling percent, memory RSS, disk read/write KB, and active process PIDs
- **Git Diff Snaps**: Automatic Git tree diff generated at the end of each turn

---

## 5. Keyboard Hotkeys During Execution

While a benchmark or sweep is active in the foreground terminal:

| Key | Action | Description |
| :--- | :--- | :--- |
| `Ctrl + C` | Graceful Halt | Finishes active turn and cleanly saves SQLite state |
| `p` | Pause / Resume | Temporarily suspends trial dispatching |
| `v` | Toggle Verbosity | Switches between compact progress bar and full event stream |
| `s` | Status Summary | Prints instantaneous cost and score summary table |

---

## Next Steps

Learn how to execute and debug individual benchmark trials:

- [Previous: CLI Command Manual](commands.md)
- [Next: Single Trial Execution](../running-benchmarks/single-trial.md)

# TUI Replay Scrubber & Trajectory Player

[Previous: Matrix Sweeps](../running-benchmarks/matrix-sweeps.md) | [Table of Contents](../README.md) | [Next: Web Streaming & PTY Tunneling](web-streaming.md)

The TUI Replay Player provides an interactive terminal scrubber for stepping through recorded agent execution trajectories frame by frame, inspecting tool invocations, examining reasoning traces, viewing Git diffs, and analyzing cgroups resource telemetry.

---

## 1. Launching the TUI Player

You can launch the player directly against any recorded trajectory file (`.json` or `.jsonl`):

```bash
bun run src/cli/index.ts replay data/trajectories/git-worktrees_using-git-worktrees_claude-3-7-sonnet.jsonl
```

If launched without arguments, the player demonstrates a sample recorded trajectory.

---

## 2. Interactive Scrubber Interface

```text
================================================================================
REPLAY: git-worktrees | Skill: using-git-worktrees | Model: claude-3-7-sonnet
Frame [  4 /  15 ] (Elapsed: 12.40s)  Speed: 1.0x  Status: [PASS]
Tabs: [1] Overview  [2] Tool Call  [3] Thinking  [4] Git Diff  [5] Telemetry
================================================================================

[TOOL CALL: run_command]
Command: git worktree add -b feat-new ../worktree-feat
Working Dir: /tmp/sandbox-10293/repo

[STDOUT OUTPUT] (Exit Code: 0 | Duration: 420ms)
Preparing worktree (new branch 'feat-new')
HEAD is now at 6ab0dc7 feat: initial architecture setup

[RESOURCE TELEMETRY]
CPU: [━━━━━───────────────] 24% | Memory RSS: [━━━━━━──────────────] 142 MB / 1024 MB
Active PIDs: 4 | Disk Read: 1,024 KB | Disk Write: 2,048 KB
```

---

## 3. Five Detailed Tab Views

Navigate between tabs using the number keys `1` through `5`:

### `1` Overview Tab
Displays the high-level trial summary, scenario description, skill manifest metadata, target model, overall score breakdown, elapsed wall-clock duration, and instantaneous generation velocity (`tokens/sec`).

### `2` Tool Call Tab
Presents the exact tool invocation payload sent by the agent, formatted JSON arguments, shell commands, and the sandbox's returned `stdout`, `stderr`, exit code, and execution duration.

### `3` Thinking Trace Tab
Displays the model's internal reasoning and chain-of-thought tokens, showing how the agent analyzed previous tool outputs and planned its next action.

### `4` Git Diff Tab (Side-by-Side & Unified)
Presents structured workspace state mutations with side-by-side terminal columns:
- **Left Column**: Baseline / Prior Turn state (colored in red for deletions and modifications)
- **Right Column**: Agent Mutation / Current Turn state (colored in green for additions)
- **Hunk Statistics**: Line insertions (`+`), deletions (`-`), and modified file paths

### `5` Telemetry Tab
Visualizes real-time system resource consumption captured via cgroups v2:
- CPU utilization percentage and throttling events
- Memory RSS vs. container memory limit
- Disk read/write throughput
- Network Rx/Tx rates
- Active child process count (PIDs)

---

## 4. Complete Keyboard Shortcuts

| Key | Action | Description |
| :--- | :--- | :--- |
| `Space` | Play / Pause | Toggle automatic trajectory playback |
| `Right` / `l` / `n` | Step Forward | Advance to next trajectory frame |
| `Left` / `h` / `p` | Step Backward | Return to previous trajectory frame |
| `Home` / `0` | Jump to Start | Move to the initial frame (Turn 1) |
| `End` / `$` | Jump to End | Move to the final evaluation frame |
| `1` | Overview Tab | Switch to overview tab |
| `2` | Tool Tab | Switch to tool call / result tab |
| `3` | Thinking Tab | Switch to model reasoning trace tab |
| `4` | Diff Tab | Switch to Git diff tab |
| `5` | Telemetry Tab | Switch to cgroups resource telemetry tab |
| `+` / `=` | Speed Up | Increase playback speed (1.5x) |
| `-` | Slow Down | Decrease playback speed (/ 1.5x) |
| `q` / `Ctrl+C` | Quit | Exit player and restore terminal state |

---

## 5. Exporting to Web Replay & JSON

You can also export recorded sessions to standalone Web replay HTML files or JSON streams:

```bash
# Export to standalone Web Replay HTML
bun run src/cli/index.ts replay --web --output ./data/replay.html ./data/trajectory.jsonl

# Export formatted JSON stream
bun run src/cli/index.ts replay --format json --output ./data/replay.json ./data/trajectory.jsonl
```

---

## Next Steps

Learn how to stream live sandbox terminals over secure web tunnels:

- [Previous: High-Throughput Matrix Sweeps](../running-benchmarks/matrix-sweeps.md)
- [Next: Live Web Streaming & PTY Tunneling](web-streaming.md)


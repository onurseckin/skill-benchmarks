import type {
  ReplaySession,
  TrajectoryFrame,
  TuiPlayerOptions,
  PlayerTab,
  ReplayPlayerState,
  CgroupTelemetryPoint,
} from "./index.js";
import {
  bold,
  dim,
  green,
  yellow,
  red,
  cyan,
  magenta,
  white,
  formatBadge,
} from "../cli/formatter.js";
import { sanitizeTerminalText } from "./terminal-text.js";

function renderBar(value: number, max: number, width: number, colorFn: (s: string) => string): string {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  const filledCount = Math.round(ratio * width);
  const emptyCount = Math.max(0, width - filledCount);
  const filledStr = colorFn("━".repeat(filledCount));
  const emptyStr = dim("─".repeat(emptyCount));
  return `[${filledStr}${emptyStr}] ${(ratio * 100).toFixed(0)}%`;
}

export class TuiReplayPlayer {
  private session: ReplaySession;
  private options: TuiPlayerOptions;
  private state: ReplayPlayerState;

  constructor(session: ReplaySession, options: TuiPlayerOptions = {}) {
    this.session = session;
    this.options = options;
    const initialIndex = options.initialFrame ?? 0;
    const clampedIndex = Math.max(0, Math.min(session.frames.length - 1, initialIndex));
    this.state = {
      currentFrameIndex: clampedIndex,
      totalFrames: session.frames.length,
      isPlaying: options.autoPlay ?? false,
      speed: options.playbackSpeed ?? 1,
      selectedTab: "overview",
    };
  }

  public getState(): ReplayPlayerState {
    return { ...this.state };
  }

  public setFrame(index: number): void {
    if (this.session.frames.length === 0) return;
    this.state = {
      ...this.state,
      currentFrameIndex: Math.max(0, Math.min(this.session.frames.length - 1, index)),
    };
  }

  public nextFrame(): void {
    if (this.state.currentFrameIndex < this.session.frames.length - 1) {
      this.setFrame(this.state.currentFrameIndex + 1);
    } else if (this.options.loop) {
      this.setFrame(0);
    } else {
      this.state = { ...this.state, isPlaying: false };
    }
  }

  public prevFrame(): void {
    if (this.state.currentFrameIndex > 0) {
      this.setFrame(this.state.currentFrameIndex - 1);
    }
  }

  public togglePlay(): void {
    this.state = { ...this.state, isPlaying: !this.state.isPlaying };
  }

  public setTab(tab: PlayerTab): void {
    this.state = { ...this.state, selectedTab: tab };
  }

  public setSpeed(speed: number): void {
    this.state = { ...this.state, speed: Math.max(0.1, Math.min(20, speed)) };
  }

  public renderHeader(frame?: TrajectoryFrame): string {
    const meta = this.session.metadata;
    const statusBadge = meta.executionStatus === "completed"
      ? formatBadge("info", "COMPLETED")
      : formatBadge("error", meta.executionStatus.toUpperCase());
    const frameNum = (this.state.currentFrameIndex + 1).toString().padStart(3, " ");
    const totalNum = this.state.totalFrames.toString().padStart(3, " ");
    const elapsedSec = frame ? (frame.elapsedMs / 1000).toFixed(2) : "0.00";
    const speedStr = `${this.state.speed.toFixed(1)}x`;

    const lines: string[] = [];
    lines.push(bold(cyan("╭─────────────────────────────────────────────────────────────────────────────╮")));
    lines.push(`${bold(cyan("│"))}  ${bold("Skill-Benchmarks Persisted Execution Replay")}  ${statusBadge}  ${dim(`[Speed: ${speedStr}]`)}`);
    lines.push(`${bold(cyan("│"))}  ${dim("Scenario:")} ${bold(sanitizeTerminalText(meta.scenarioId))}  ${dim("Skills:")} ${bold(sanitizeTerminalText(meta.skillIds.join(", ")))}  ${dim("Model:")} ${bold(sanitizeTerminalText(meta.modelId))}`);
    const provenance = [meta.providerId, meta.executionMode, meta.simulated === undefined ? undefined : (meta.simulated ? "simulated" : "nonsimulated")].filter(Boolean).join(" | ");
    if (provenance.length > 0) lines.push(`${bold(cyan("│"))}  ${dim("Provenance:")} ${white(sanitizeTerminalText(provenance))}`);
    lines.push(`${bold(cyan("│"))}  ${dim("Frame:")} ${green(frameNum)}/${cyan(totalNum)}  ${dim("Turn:")} ${yellow(frame?.turnIndex?.toString() ?? "—")}  ${dim("Time:")} ${white(`${elapsedSec}s`)}`);
    lines.push(bold(cyan("╰─────────────────────────────────────────────────────────────────────────────╯")));
    return lines.join("\n");
  }

  public renderTimeline(): string {
    const width = 50;
    const total = Math.max(1, this.state.totalFrames);
    const curr = this.state.currentFrameIndex;
    const pos = Math.floor((curr / total) * width);
    const chars: string[] = [];

    for (let i = 0; i < width; i++) {
      if (i === pos) {
        chars.push(this.state.isPlaying ? green("▶") : yellow("❚"));
      } else {
        const frameIdx = Math.floor((i / width) * total);
        const f = this.session.frames[frameIdx];
        if (f?.eventType === "tool_call") chars.push(cyan("•"));
        else if (f?.eventType === "git_diff") chars.push(magenta("Δ"));
        else if (f?.eventType === "error") chars.push(red("!"));
        else chars.push(dim("─"));
      }
    }

    const pct = ((curr / (total - 1 || 1)) * 100).toFixed(0).padStart(3, " ");
    return `[${chars.join("")}] ${pct}% (${curr + 1}/${total})`;
  }

  public renderTabs(): string {
    const tabs: readonly { key: PlayerTab; label: string; num: string }[] = [
      { key: "overview", label: "Overview", num: "1" },
      { key: "tool", label: "Tool Call", num: "2" },
      { key: "thinking", label: "Thinking", num: "3" },
      { key: "diff", label: "Diffs", num: "4" },
      { key: "telemetry", label: "Telemetry", num: "5" },
    ];

    const rendered = tabs.map((t) => {
      const active = this.state.selectedTab === t.key;
      const tag = `[${t.num}:${t.label}]`;
      return active ? bold(green(tag)) : dim(tag);
    });

    return `  Tabs: ${rendered.join("  ")}`;
  }

  public renderContent(frame?: TrajectoryFrame): string {
    if (!frame) return dim("  No frame data available.");

    const lines: string[] = [];
    switch (this.state.selectedTab) {
      case "overview": {
        lines.push(bold("  Event Summary:"));
        lines.push(`    ${cyan("•")} Type:    ${bold(frame.eventType.toUpperCase())}`);
        lines.push(`    ${cyan("•")} Summary: ${sanitizeTerminalText(frame.summary)}`);
        if (frame.turnIndex !== undefined) lines.push(`    ${cyan("•")} Turn:    #${frame.turnIndex}`);
        lines.push(`    ${cyan("•")} Elapsed: ${frame.elapsedMs}ms`);
        if (frame.totalTokens !== undefined) lines.push(`    ${cyan("•")} Tokens:  ${frame.totalTokens}`);
        if (frame.totalCostUSD !== undefined) lines.push(`    ${cyan("•")} Cost:    $${frame.totalCostUSD.toFixed(4)}`);
        if (frame.elapsedMs > 0 && frame.totalTokens !== undefined) {
          const velocity = (frame.totalTokens / (frame.elapsedMs / 1000)).toFixed(1);
          lines.push(`    ${cyan("•")} Velocity: ${green(velocity)} tok/s`);
        }
        break;
      }
      case "tool": {
        if (frame.toolCall) {
          const tc = frame.toolCall;
          lines.push(bold(`  Tool Invocation: ${cyan(sanitizeTerminalText(tc.toolName))}`));
          lines.push(`    Call ID:  ${dim(sanitizeTerminalText(tc.callId))}`);
          if (tc.inputPayload !== undefined) lines.push(`    Payload:  ${dim(sanitizeTerminalText(JSON.stringify(tc.inputPayload)))}`);
          if (tc.durationMs !== undefined) lines.push(`    Duration: ${tc.durationMs}ms`);
          if (tc.exitCode !== undefined) lines.push(`    Exit:     ${tc.exitCode === 0 ? green("0 (OK)") : red(tc.exitCode.toString())}`);
        } else if (frame.command) {
          const command = frame.command;
          lines.push(bold(`  Persisted Command: ${cyan(sanitizeTerminalText(command.commandId))}`));
          if (command.stream !== undefined) lines.push(`    Stream:   ${command.stream}`);
          if (command.chunk !== undefined) lines.push(`    Chunk:    ${dim(sanitizeTerminalText(command.chunk.slice(0, 240)))}`);
          if (command.durationMs !== undefined) lines.push(`    Duration: ${command.durationMs}ms`);
          if (command.exitCode !== undefined) lines.push(`    Exit:     ${command.exitCode}`);
        } else {
          lines.push(dim("  No tool or command evidence in this frame."));
        }
        break;
      }
      case "thinking": {
        if (frame.thinking) {
          lines.push(bold(`  Model Reasoning Stream (${frame.thinking.tokenCount} tokens):`));
          lines.push(`    ${dim(sanitizeTerminalText(frame.thinking.thoughtChunk.slice(0, 240)))}`);
        } else {
          lines.push(dim("  No thinking tokens in this frame."));
        }
        break;
      }
      case "diff": {
        if (frame.diff) {
          const d = frame.diff;
          lines.push(bold(`  File Mutation (Side-by-Side): ${cyan(sanitizeTerminalText(d.path))} [${d.changeType.toUpperCase()}]`));
          lines.push(`    Changes: ${green(`+${d.insertions} additions`)} | ${red(`-${d.deletions} deletions`)}`);
          lines.push(`    ${dim("┌───────────────────────────┬───────────────────────────┐")}`);
          lines.push(`    ${dim("│")} ${bold(red("BEFORE / BASELINE"))}${" ".repeat(10)} ${dim("│")} ${bold(green("AFTER / AGENT MUTATION"))}${" ".repeat(5)} ${dim("│")}`);
          lines.push(`    ${dim("├───────────────────────────┼───────────────────────────┤")}`);
          if (d.diffHunk) {
            const hunkLines = sanitizeTerminalText(d.diffHunk).split("\n").slice(0, 6);
            for (const hl of hunkLines) {
              if (hl.startsWith("+")) {
                const right = hl.slice(1).padEnd(25, " ").slice(0, 25);
                lines.push(`    ${dim("│")} ${" ".repeat(25)} ${dim("│")} ${green(right)} ${dim("│")}`);
              } else if (hl.startsWith("-")) {
                const left = hl.slice(1).padEnd(25, " ").slice(0, 25);
                lines.push(`    ${dim("│")} ${red(left)} ${dim("│")} ${" ".repeat(25)} ${dim("│")}`);
              } else {
                const ctx = hl.startsWith(" ") ? hl.slice(1).padEnd(25, " ").slice(0, 25) : hl.padEnd(25, " ").slice(0, 25);
                lines.push(`    ${dim("│")} ${dim(ctx)} ${dim("│")} ${dim(ctx)} ${dim("│")}`);
              }
            }
          }
          lines.push(`    ${dim("└───────────────────────────┴───────────────────────────┘")}`);
        } else {
          lines.push(dim("  No git diff changes in this frame."));
        }
        break;
      }
      case "telemetry": {
        const tel: CgroupTelemetryPoint | undefined = frame.telemetry;
        if (tel) {
          lines.push(bold("  Cgroup Host & Container Telemetry:"));
          lines.push(`    CPU Usage:     ${renderBar(tel.cpuPercent, 100, 20, (s) => (tel.cpuPercent > 80 ? red(s) : green(s)))} (${tel.cpuPercent.toFixed(1)}%)`);
          lines.push(`    Memory RSS:    ${renderBar(tel.memoryRssMb, tel.memoryLimitMb, 20, (s) => (tel.memoryPercent > 80 ? red(s) : yellow(s)))} (${tel.memoryRssMb.toFixed(1)}MB / ${tel.memoryLimitMb}MB)`);
          lines.push(`    Disk I/O:      Read ${tel.diskReadKb}KB | Write ${tel.diskWriteKb}KB`);
          lines.push(`    Network I/O:   Rx ${tel.networkRxKb}KB | Tx ${tel.networkTxKb}KB`);
          lines.push(`    Active PIDs:   ${tel.activePids}`);
        } else {
          lines.push(dim("  No cgroup telemetry recorded."));
        }
        break;
      }
    }
    return lines.join("\n");
  }

  public renderControls(): string {
    return [
      bold(dim("─────────────────────────────────────────────────────────────────────────────")),
      dim(" [Space] Play/Pause  [←/→] Prev/Next  [Home/End] Start/End  [1-5] Tab  [+/-] Speed  [q] Quit"),
    ].join("\n");
  }

  public renderFrame(index?: number): string {
    const targetIndex = index ?? this.state.currentFrameIndex;
    const frame = this.session.frames[targetIndex];
    return [
      this.renderHeader(frame),
      `  Timeline: ${this.renderTimeline()}`,
      this.renderTabs(),
      dim("─────────────────────────────────────────────────────────────────────────────"),
      this.renderContent(frame),
      this.renderControls(),
    ].join("\n");
  }

  public async playInteractive(): Promise<void> {
    if (!process.stdin.isTTY) {
      console.log(this.renderFrame(0));
      if (this.session.frames.length > 1) {
        console.log(this.renderFrame(this.session.frames.length - 1));
      }
      return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const clearScreen = (): void => {
      process.stdout.write("\u001b[2J\u001b[0;0H");
    };

    const redraw = (): void => {
      clearScreen();
      process.stdout.write(`${this.renderFrame()}\n`);
    };

    redraw();

    let timer: ReturnType<typeof setInterval> | null = null;
    const startPlaybackTimer = (): void => {
      if (timer) clearInterval(timer);
      const intervalMs = Math.max(20, Math.round(500 / this.state.speed));
      timer = setInterval(() => {
        if (this.state.isPlaying) {
          this.nextFrame();
          redraw();
        }
      }, intervalMs);
    };

    if (this.state.isPlaying) {
      startPlaybackTimer();
    }

    return new Promise<void>((resolve) => {
      const onData = (key: string): void => {
        if (key === "q" || key === "\u0003") {
          if (timer) clearInterval(timer);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          clearScreen();
          resolve();
          return;
        }

        if (key === " ") {
          this.togglePlay();
          if (this.state.isPlaying) startPlaybackTimer();
          else if (timer) clearInterval(timer);
        } else if (key === "\u001b[C" || key === "l" || key === "n") {
          this.nextFrame();
        } else if (key === "\u001b[D" || key === "h" || key === "p") {
          this.prevFrame();
        } else if (key === "\u001b[H" || key === "0") {
          this.setFrame(0);
        } else if (key === "\u001b[F" || key === "$") {
          this.setFrame(this.session.frames.length - 1);
        } else if (key === "1") this.setTab("overview");
        else if (key === "2") this.setTab("tool");
        else if (key === "3") this.setTab("thinking");
        else if (key === "4") this.setTab("diff");
        else if (key === "5") this.setTab("telemetry");
        else if (key === "+" || key === "=") {
          this.setSpeed(this.state.speed * 1.5);
          if (this.state.isPlaying) startPlaybackTimer();
        } else if (key === "-") {
          this.setSpeed(this.state.speed / 1.5);
          if (this.state.isPlaying) startPlaybackTimer();
        }

        redraw();
      };

      process.stdin.on("data", onData);
    });
  }
}

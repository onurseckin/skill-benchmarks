import type {
  AppState,
  AppView,
  LeaderboardSortKey,
  LiveTelemetryViewModel,
  ReplayTab,
  ReplayViewModel,
  SortDirection,
  SpaCompilerOptions,
  SseConnectionStatus,
  SseEvent,
  SseSubscriptionConfig,
  ThemeMode,
  ThemeTokens,
} from "./types.js";
import type {
  EloRatingRecord,
  LeaderboardEntry,
  RunRecord,
  SkillBenchmarkSummary,
} from "../reporting/types.js";
import type {
  CgroupTelemetryPoint,
  ReplaySession,
  TrajectoryFrame,
} from "../replay/types.js";
import type { LiveTelemetryPayload } from "../server/types.js";

function makeTheme(
  bg: string, bgSec: string, surf: string, surfAlt: string, surfHov: string,
  border: string, borderStr: string, text: string, textMut: string, textDim: string,
  prim: string, primHov: string, primAlpha: string, acc: string,
  succ: string, succBg: string, warn: string, warnBg: string,
  err: string, errBg: string, mauve: string, cyan: string
): ThemeTokens {
  return {
    bg, bgSecondary: bgSec, surface: surf, surfaceAlt: surfAlt, surfaceHover: surfHov,
    border, borderStrong: borderStr, text, textMuted: textMut, textDim,
    primary: prim, primaryHover: primHov, primaryAlpha: primAlpha, accent: acc,
    success: succ, successBg: succBg, warning: warn, warningBg: warnBg,
    error: err, errorBg: errBg, mauve, cyan,
    fontMono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  };
}

export const THEME_DARK = makeTheme(
  "#0b0f19", "#111827", "#182235", "#1e293b", "#243248",
  "#334155", "#475569", "#f8fafc", "#94a3b8", "#64748b",
  "#38bdf8", "#0ea5e9", "rgba(56, 189, 248, 0.15)", "#818cf8",
  "#34d399", "rgba(52, 211, 153, 0.15)", "#fbbf24", "rgba(251, 191, 36, 0.15)",
  "#f87171", "rgba(248, 113, 113, 0.15)", "#c084fc", "#22d3ee"
);

export const THEME_LIGHT = makeTheme(
  "#f8fafc", "#f1f5f9", "#ffffff", "#e2e8f0", "#cbd5e1",
  "#cbd5e1", "#94a3b8", "#0f172a", "#475569", "#64748b",
  "#0284c7", "#0369a1", "rgba(2, 132, 199, 0.12)", "#6366f1",
  "#059669", "rgba(5, 150, 105, 0.12)", "#d97706", "rgba(217, 119, 6, 0.12)",
  "#dc2626", "rgba(220, 38, 38, 0.12)", "#9333ea", "#0891b2"
);

export const THEME_HIGH_CONTRAST = makeTheme(
  "#000000", "#0a0a0a", "#121212", "#242424", "#333333",
  "#ffffff", "#ffff00", "#ffffff", "#e0e0e0", "#b0b0b0",
  "#00e5ff", "#80d8ff", "rgba(0, 229, 255, 0.25)", "#ffff00",
  "#00ff66", "rgba(0, 255, 102, 0.25)", "#ffea00", "rgba(255, 234, 0, 0.25)",
  "#ff1744", "rgba(255, 23, 68, 0.25)", "#ea80fc", "#18ffff"
);

export const THEME_CYBERPUNK = makeTheme(
  "#0d0221", "#19053b", "#260c55", "#381373", "#4e1b9b",
  "#ff007f", "#00f0ff", "#00f0ff", "#d946ef", "#a855f7",
  "#ff007f", "#ff409f", "rgba(255, 0, 127, 0.2)", "#ffe600",
  "#00ff9f", "rgba(0, 255, 159, 0.2)", "#ffe600", "rgba(255, 230, 0, 0.2)",
  "#ff0055", "rgba(255, 0, 85, 0.2)", "#bd00ff", "#00f0ff"
);

export const THEME_MONOCHROME = makeTheme(
  "#121212", "#1c1c1c", "#262626", "#333333", "#444444",
  "#555555", "#888888", "#eeeeee", "#aaaaaa", "#777777",
  "#ffffff", "#dddddd", "rgba(255, 255, 255, 0.15)", "#cccccc",
  "#e0e0e0", "rgba(255, 255, 255, 0.1)", "#d0d0d0", "rgba(255, 255, 255, 0.1)",
  "#f0f0f0", "rgba(255, 255, 255, 0.1)", "#dddddd", "#ffffff"
);

export const THEMES: Readonly<Record<ThemeMode, ThemeTokens>> = {
  dark: THEME_DARK,
  light: THEME_LIGHT,
  "high-contrast": THEME_HIGH_CONTRAST,
  cyberpunk: THEME_CYBERPUNK,
  monochrome: THEME_MONOCHROME,
};

export function createInitialState(options: SpaCompilerOptions = {}): AppState {
  const mode = options.initialTheme ?? "dark";
  const theme = THEMES[mode] ?? THEME_DARK;
  const runs = options.embeddedData?.runs ?? [];
  const entries = options.embeddedData?.leaderboard ?? [];
  const session = options.embeddedData?.session;
  const categories = Array.from(new Set(entries.map((e) => e.category))).sort();

  return {
    activeView: options.initialView ?? "leaderboard",
    themeMode: mode,
    theme,
    leaderboard: {
      entries,
      eloRatings: [],
      categories,
      activeCategory: "all",
      searchFilter: "",
      sortKey: "rank",
      sortDirection: "asc",
      page: 1,
      pageSize: 25,
      totalCount: entries.length,
    },
    replay: {
      session,
      activeRunId: session?.metadata.runId,
      currentFrameIndex: 0,
      totalFrames: session?.frames.length ?? 0,
      isPlaying: false,
      playbackSpeed: 1,
      activeTab: "overview",
      searchFilter: "",
    },
    live: {
      isConnected: false,
      status: "disconnected",
      receivedEventCount: 0,
      bufferedFrames: [],
      peakCpuPercent: 0,
      peakMemoryMb: 0,
      autoFollow: true,
    },
    runs,
    summaries: [],
  };
}

export class DashboardStateManager {
  private state: AppState;
  private readonly listeners = new Set<(state: AppState) => void>();
  private sseEventSource: EventSource | null = null;
  private playbackTimer: ReturnType<typeof setInterval> | null = null;

  public constructor(initialOptions?: SpaCompilerOptions) {
    this.state = createInitialState(initialOptions);
  }

  public getState(): AppState {
    return this.state;
  }

  public subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  public dispatch(updater: (prev: AppState) => AppState): void {
    this.state = updater(this.state);
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {}
    }
  }

  public setView(view: AppView): void {
    this.dispatch((prev) => ({ ...prev, activeView: view }));
  }

  public setTheme(mode: ThemeMode): void {
    const theme = THEMES[mode] ?? THEME_DARK;
    this.dispatch((prev) => ({ ...prev, themeMode: mode, theme }));
  }

  public setNotification(message: string, type: "info" | "success" | "warning" | "error" = "info"): void {
    this.dispatch((prev) => ({ ...prev, notification: { message, type, timestamp: Date.now() } }));
  }

  public clearNotification(): void {
    this.dispatch((prev) => ({ ...prev, notification: undefined }));
  }

  public setLeaderboardData(entries: readonly LeaderboardEntry[], eloRatings: readonly EloRatingRecord[] = []): void {
    const categories = Array.from(new Set(entries.map((e) => e.category))).sort();
    this.dispatch((prev) => ({
      ...prev,
      leaderboard: { ...prev.leaderboard, entries, eloRatings, categories, totalCount: entries.length },
    }));
  }

  public setCategoryFilter(activeCategory: string): void {
    this.dispatch((prev) => ({ ...prev, leaderboard: { ...prev.leaderboard, activeCategory, page: 1 } }));
  }

  public setLeaderboardSearch(searchFilter: string): void {
    this.dispatch((prev) => ({ ...prev, leaderboard: { ...prev.leaderboard, searchFilter, page: 1 } }));
  }

  public setLeaderboardSort(sortKey: LeaderboardSortKey, direction?: SortDirection): void {
    this.dispatch((prev) => {
      const nextDir = direction ?? (prev.leaderboard.sortKey === sortKey && prev.leaderboard.sortDirection === "asc" ? "desc" : "asc");
      return { ...prev, leaderboard: { ...prev.leaderboard, sortKey, sortDirection: nextDir } };
    });
  }

  public selectLeaderboardSkill(selectedSkillId?: string): void {
    this.dispatch((prev) => ({ ...prev, leaderboard: { ...prev.leaderboard, selectedSkillId } }));
  }

  public setLeaderboardPage(page: number, pageSize?: number): void {
    this.dispatch((prev) => ({
      ...prev,
      leaderboard: { ...prev.leaderboard, page: Math.max(1, page), pageSize: pageSize ?? prev.leaderboard.pageSize },
    }));
  }

  public getFilteredLeaderboardEntries(): readonly LeaderboardEntry[] {
    const { entries, activeCategory, searchFilter, sortKey, sortDirection } = this.state.leaderboard;
    const query = searchFilter.toLowerCase().trim();
    const filtered = entries.filter((item) => {
      const matchCat = activeCategory === "all" || item.category === activeCategory;
      const matchSearch = !query || item.skillId.toLowerCase().includes(query) || item.category.toLowerCase().includes(query);
      return matchCat && matchSearch;
    });

    return [...filtered].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDirection === "asc" ? String(aVal ?? "").localeCompare(String(bVal ?? "")) : String(bVal ?? "").localeCompare(String(aVal ?? ""));
    });
  }

  public loadReplaySession(session: ReplaySession): void {
    this.dispatch((prev) => ({
      ...prev,
      replay: {
        ...prev.replay,
        session,
        activeRunId: session.metadata.runId,
        currentFrameIndex: 0,
        totalFrames: session.frames.length,
        isPlaying: false,
      },
    }));
  }

  public setCurrentFrame(index: number): void {
    const total = this.state.replay.totalFrames;
    const bounded = Math.max(0, Math.min(Math.max(0, total - 1), index));
    this.dispatch((prev) => ({ ...prev, replay: { ...prev.replay, currentFrameIndex: bounded } }));
  }

  public stepFrame(delta: number): void {
    this.setCurrentFrame(this.state.replay.currentFrameIndex + delta);
  }

  public setPlaying(isPlaying: boolean): void {
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
    if (isPlaying) {
      const intervalMs = Math.round(500 / this.state.replay.playbackSpeed);
      this.playbackTimer = setInterval(() => {
        const { currentFrameIndex, totalFrames } = this.state.replay;
        if (currentFrameIndex < totalFrames - 1) this.stepFrame(1);
        else this.setPlaying(false);
      }, intervalMs);
    }
    this.dispatch((prev) => ({ ...prev, replay: { ...prev.replay, isPlaying } }));
  }

  public setPlaybackSpeed(speed: number): void {
    const safeSpeed = Math.max(0.25, Math.min(10, speed));
    this.dispatch((prev) => ({ ...prev, replay: { ...prev.replay, playbackSpeed: safeSpeed } }));
    if (this.state.replay.isPlaying) {
      this.setPlaying(false);
      this.setPlaying(true);
    }
  }

  public setReplayTab(activeTab: ReplayTab): void {
    this.dispatch((prev) => ({ ...prev, replay: { ...prev.replay, activeTab } }));
  }

  public setReplaySearch(searchFilter: string): void {
    this.dispatch((prev) => ({ ...prev, replay: { ...prev.replay, searchFilter } }));
  }

  public getFilteredReplayFrames(): readonly TrajectoryFrame[] {
    const { session, searchFilter } = this.state.replay;
    if (!session) return [];
    const query = searchFilter.toLowerCase().trim();
    if (!query) return session.frames;
    return session.frames.filter((f) => {
      return f.summary.toLowerCase().includes(query) || f.eventType.toLowerCase().includes(query) ||
        (f.toolCall?.toolName.toLowerCase().includes(query) ?? false) || (f.diff?.path.toLowerCase().includes(query) ?? false);
    });
  }

  public connectSse(config: SseSubscriptionConfig = {}): void {
    this.disconnectSse();
    const endpoint = config.endpoint ?? "/api/sse";
    const url = new URL(endpoint, typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
    if (config.runId) url.searchParams.set("runId", config.runId);

    this.dispatch((prev) => ({ ...prev, live: { ...prev.live, status: "connecting", isConnected: false } }));

    if (typeof EventSource !== "undefined") {
      try {
        const es = new EventSource(url.toString());
        this.sseEventSource = es;
        es.onopen = () => {
          this.dispatch((prev) => ({ ...prev, live: { ...prev.live, status: "connected", isConnected: true } }));
          config.onStatusChange?.("connected");
        };
        es.onerror = () => {
          this.dispatch((prev) => ({ ...prev, live: { ...prev.live, status: "error", isConnected: false } }));
          config.onError?.(new Error("SSE connection error"));
        };
        es.onmessage = (msg) => {
          try {
            const data: unknown = JSON.parse(msg.data);
            const sseEvent: SseEvent = { event: msg.type || "message", data };
            this.handleSseEvent(sseEvent);
            config.onEvent?.(sseEvent);
          } catch {}
        };
      } catch {
        this.dispatch((prev) => ({ ...prev, live: { ...prev.live, status: "error", isConnected: false } }));
      }
    }
  }

  public disconnectSse(): void {
    if (this.sseEventSource) {
      this.sseEventSource.close();
      this.sseEventSource = null;
    }
    this.dispatch((prev) => ({ ...prev, live: { ...prev.live, status: "disconnected", isConnected: false } }));
  }

  public handleSseEvent(event: SseEvent): void {
    const payload = event.data as LiveTelemetryPayload;
    if (!payload || typeof payload !== "object") return;

    this.dispatch((prev) => {
      const count = prev.live.receivedEventCount + 1;
      const cgroup = payload.cgroup;
      const peakCpu = cgroup ? Math.max(prev.live.peakCpuPercent, cgroup.cpuPercent) : prev.live.peakCpuPercent;
      const peakMem = cgroup ? Math.max(prev.live.peakMemoryMb, cgroup.memoryRssMb) : prev.live.peakMemoryMb;
      let nextFrames = prev.live.bufferedFrames;
      if (payload.frame) {
        nextFrames = [...nextFrames, payload.frame].slice(-500);
      }
      return {
        ...prev,
        live: {
          ...prev.live,
          receivedEventCount: count,
          peakCpuPercent: peakCpu,
          peakMemoryMb: peakMem,
          bufferedFrames: nextFrames,
          latestMetrics: payload,
          lastHeartbeat: new Date().toISOString(),
        },
      };
    });
  }

  public clearLiveBuffer(): void {
    this.dispatch((prev) => ({
      ...prev,
      live: { ...prev.live, bufferedFrames: [], receivedEventCount: 0, peakCpuPercent: 0, peakMemoryMb: 0 },
    }));
  }
}

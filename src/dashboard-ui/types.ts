import type {
  EloRatingRecord,
  LeaderboardEntry,
  RunRecord,
  RunStatus,
  SkillBenchmarkSummary,
} from "../reporting/types.js";
import type {
  CgroupTelemetryPoint,
  DiffDelta,
  ReplayFrameType,
  ReplaySession,
  ThinkingEvent,
  ToolCallEvent,
  TrajectoryFrame,
} from "../replay/types.js";
import type {
  ApiHealthResponse,
  ApiLeaderboardResponse,
  ApiReplayResponse,
  ApiRunsResponse,
  ApiSummaryResponse,
  LiveTelemetryPayload,
  SseEvent,
  SseEventType,
} from "../server/types.js";

export type AppView = "leaderboard" | "replay" | "live" | "analytics" | "runs" | "settings";

export type ThemeMode = "dark" | "light" | "high-contrast" | "cyberpunk" | "monochrome";

export interface ThemeTokens {
  readonly bg: string;
  readonly bgSecondary: string;
  readonly surface: string;
  readonly surfaceAlt: string;
  readonly surfaceHover: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly text: string;
  readonly textMuted: string;
  readonly textDim: string;
  readonly primary: string;
  readonly primaryHover: string;
  readonly primaryAlpha: string;
  readonly accent: string;
  readonly success: string;
  readonly successBg: string;
  readonly warning: string;
  readonly warningBg: string;
  readonly error: string;
  readonly errorBg: string;
  readonly mauve: string;
  readonly cyan: string;
  readonly fontMono: string;
  readonly fontSans: string;
}

export interface NeoBrutalistComponentTokens {
  readonly borderWidth: string;
  readonly borderColor: string;
  readonly shadowOffset: string;
  readonly borderRadius: string;
  readonly fontMono: string;
}

export type SseConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting" | "error";

export interface SseSubscriptionConfig {
  readonly endpoint?: string;
  readonly runId?: string;
  readonly autoReconnect?: boolean;
  readonly reconnectIntervalMs?: number;
  readonly maxReconnectAttempts?: number;
  readonly onEvent?: (event: SseEvent) => void;
  readonly onError?: (error: Error) => void;
  readonly onStatusChange?: (status: SseConnectionStatus) => void;
}

export type SortDirection = "asc" | "desc";

export type LeaderboardSortKey =
  | "rank"
  | "skillId"
  | "category"
  | "passRate"
  | "averageScore"
  | "eloRating"
  | "meanDurationSeconds"
  | "averageCostUSD"
  | "cacheHitRatio"
  | "totalRuns";

export interface LeaderboardViewModel {
  readonly entries: readonly LeaderboardEntry[];
  readonly eloRatings: readonly EloRatingRecord[];
  readonly categories: readonly string[];
  readonly activeCategory: string;
  readonly searchFilter: string;
  readonly sortKey: LeaderboardSortKey;
  readonly sortDirection: SortDirection;
  readonly selectedSkillId?: string;
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
}

export type ReplayTab = "overview" | "tool" | "thinking" | "diff" | "telemetry";

export interface ReplayViewModel {
  readonly session?: ReplaySession;
  readonly activeRunId?: string;
  readonly currentFrameIndex: number;
  readonly totalFrames: number;
  readonly isPlaying: boolean;
  readonly playbackSpeed: number;
  readonly activeTab: ReplayTab;
  readonly searchFilter: string;
  readonly selectedDiffPath?: string;
  readonly filterEventType?: string;
}

export interface LiveTelemetryViewModel {
  readonly activeRunId?: string;
  readonly isConnected: boolean;
  readonly status: SseConnectionStatus;
  readonly receivedEventCount: number;
  readonly lastHeartbeat?: string;
  readonly bufferedFrames: readonly TrajectoryFrame[];
  readonly peakCpuPercent: number;
  readonly peakMemoryMb: number;
  readonly latestMetrics?: Partial<LiveTelemetryPayload>;
  readonly autoFollow: boolean;
}

export interface ChartPoint {
  readonly x: number;
  readonly y: number;
  readonly label?: string;
  readonly timestamp?: number | string;
  readonly value: number;
}

export interface ChartSeries {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly points: readonly ChartPoint[];
  readonly unit?: string;
}

export interface TelemetryChartData {
  readonly series: readonly ChartSeries[];
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly xLabels?: readonly string[];
  readonly width?: number;
  readonly height?: number;
}

export type MetricBadgeVariant =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "neutral"
  | "primary"
  | "mauve"
  | "cyan";

export interface MetricBadgeModel {
  readonly label: string;
  readonly value: string | number;
  readonly variant: MetricBadgeVariant;
  readonly icon?: string;
  readonly tooltip?: string;
  readonly delta?: string;
  readonly deltaPositive?: boolean;
}

export type DiffLineType = "add" | "del" | "ctx" | "header";

export interface DiffLineModel {
  readonly type: DiffLineType;
  readonly content: string;
  readonly oldLineNumber?: number;
  readonly newLineNumber?: number;
}

export interface DiffViewModel {
  readonly path: string;
  readonly changeType: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly lines: readonly DiffLineModel[];
  readonly isBinary?: boolean;
}

export interface KpiCardModel {
  readonly id: string;
  readonly title: string;
  readonly value: string | number;
  readonly subtitle?: string;
  readonly variant?: MetricBadgeVariant;
  readonly icon?: string;
}

export interface AppNotification {
  readonly message: string;
  readonly type: "info" | "success" | "warning" | "error";
  readonly timestamp: number;
}

export interface AppState {
  readonly activeView: AppView;
  readonly themeMode: ThemeMode;
  readonly theme: ThemeTokens;
  readonly leaderboard: LeaderboardViewModel;
  readonly replay: ReplayViewModel;
  readonly live: LiveTelemetryViewModel;
  readonly runs: readonly RunRecord[];
  readonly summaries: readonly SkillBenchmarkSummary[];
  readonly activeModal?: string;
  readonly notification?: AppNotification;
}

export interface SpaCompilerOptions {
  readonly title?: string;
  readonly initialView?: AppView;
  readonly initialTheme?: ThemeMode;
  readonly embeddedData?: {
    readonly runs?: readonly RunRecord[];
    readonly leaderboard?: readonly LeaderboardEntry[];
    readonly session?: ReplaySession;
  };
  readonly apiBaseUrl?: string;
  readonly sseUrl?: string;
}

export type {
  EloRatingRecord,
  LeaderboardEntry,
  RunRecord,
  RunStatus,
  SkillBenchmarkSummary,
  CgroupTelemetryPoint,
  DiffDelta,
  ReplayFrameType,
  ReplaySession,
  ThinkingEvent,
  ToolCallEvent,
  TrajectoryFrame,
  ApiHealthResponse,
  ApiLeaderboardResponse,
  ApiReplayResponse,
  ApiRunsResponse,
  ApiSummaryResponse,
  LiveTelemetryPayload,
  SseEvent,
  SseEventType,
};

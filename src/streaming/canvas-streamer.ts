import type {
  AnsiStyle,
  BarChartModel,
  CanvasCell,
  CanvasDimensions,
  CanvasFrame,
  CanvasStreamerOptions,
  CellDelta,
  FrameCompressionFormat,
  FrameDelta,
  FrameStats,
  HistogramChartModel,
  HudOverlayConfig,
  HudSnapshot,
  SparklineChartModel,
} from "./types.js";
import { styleToAnsi } from "./canvas-ansi.js";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_FPS = 30;
const SPARKLINE_BLOCKS = [" ", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

function computeFnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export class CanvasStreamer {
  private cols: number;
  private rows: number;
  private targetFps: number;
  private compressionFormat: FrameCompressionFormat;
  private hudConfig: HudOverlayConfig;
  private currentGrid: CanvasCell[][];
  private previousGrid: CanvasCell[][];
  private frameSequence: number = 0;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private isStreaming: boolean = false;
  private readonly onFrameCallback?: (frame: CanvasFrame) => void;
  private readonly onErrorCallback?: (error: Error) => void;
  private readonly onResizeCallback?: (dimensions: CanvasDimensions) => void;

  constructor(options?: CanvasStreamerOptions) {
    const vp = options !== undefined ? options.viewport : undefined;
    const hud = options !== undefined ? options.hud : undefined;
    this.cols = vp !== undefined && vp.cols !== undefined ? vp.cols : DEFAULT_COLS;
    this.rows = vp !== undefined && vp.rows !== undefined ? vp.rows : DEFAULT_ROWS;

    if (options !== undefined && options.targetFps !== undefined) {
      this.targetFps = options.targetFps;
    } else if (vp !== undefined && vp.fps !== undefined) {
      this.targetFps = vp.fps;
    } else {
      this.targetFps = DEFAULT_FPS;
    }

    this.compressionFormat =
      options !== undefined && options.compression !== undefined
        ? options.compression
        : "ansi-delta";
    this.hudConfig = {
      enabled: hud !== undefined && hud.enabled !== undefined ? hud.enabled : false,
      showFps: hud !== undefined && hud.showFps !== undefined ? hud.showFps : true,
      showLatency: hud !== undefined && hud.showLatency !== undefined ? hud.showLatency : true,
      showResourceUsage:
        hud !== undefined && hud.showResourceUsage !== undefined ? hud.showResourceUsage : true,
      showTimestamp:
        hud !== undefined && hud.showTimestamp !== undefined ? hud.showTimestamp : true,
      showContainerId:
        hud !== undefined && hud.showContainerId !== undefined ? hud.showContainerId : true,
      showTitle: hud !== undefined && hud.showTitle !== undefined ? hud.showTitle : true,
      title:
        hud !== undefined && hud.title !== undefined ? hud.title : "Skill Benchmark Live Canvas",
      position: hud !== undefined && hud.position !== undefined ? hud.position : "top-right",
      customBadges: hud !== undefined && hud.customBadges !== undefined ? hud.customBadges : [],
    };
    this.onFrameCallback = options !== undefined ? options.onFrame : undefined;
    this.onErrorCallback = options !== undefined ? options.onError : undefined;
    this.onResizeCallback = options !== undefined ? options.onResize : undefined;
    this.currentGrid = this.createEmptyGrid(this.cols, this.rows);
    this.previousGrid = this.createEmptyGrid(this.cols, this.rows);
  }

  private createEmptyGrid(cols: number, rows: number): CanvasCell[][] {
    const grid: CanvasCell[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: CanvasCell[] = [];
      for (let c = 0; c < cols; c++) row.push({ char: " ", style: {}, dirty: false });
      grid.push(row);
    }
    return grid;
  }

  public getDimensions(): CanvasDimensions {
    return { cols: this.cols, rows: this.rows };
  }

  public resize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.currentGrid = this.createEmptyGrid(cols, rows);
    this.previousGrid = this.createEmptyGrid(cols, rows);
    if (this.onResizeCallback !== undefined) this.onResizeCallback({ cols, rows });
  }

  public clear(): void {
    for (let r = 0; r < this.rows; r++) {
      const row = this.currentGrid[r];
      if (row === undefined) continue;
      for (let c = 0; c < this.cols; c++) row[c] = { char: " ", style: {}, dirty: true };
    }
  }

  public setCell(x: number, y: number, char: string, style: AnsiStyle = {}): void {
    if (x < 0) return;
    if (x >= this.cols) return;
    if (y < 0) return;
    if (y >= this.rows) return;
    const row = this.currentGrid[y];
    if (row === undefined) return;
    const charElem = char[0];
    const safeChar = char.length > 0 && charElem !== undefined ? charElem : " ";
    row[x] = { char: safeChar, style, dirty: true };
  }

  public drawText(x: number, y: number, text: string, style: AnsiStyle = {}): void {
    if (y < 0) return;
    if (y >= this.rows) return;
    for (let i = 0; i < text.length; i++) {
      const targetX = x + i;
      if (targetX >= this.cols) break;
      if (targetX >= 0) {
        const textElem = text[i];
        this.setCell(targetX, y, textElem !== undefined ? textElem : " ", style);
      }
    }
  }

  public drawBox(
    x: number,
    y: number,
    width: number,
    height: number,
    title?: string,
    style: AnsiStyle = {},
  ): void {
    if (width < 2) return;
    if (height < 2) return;
    const right = Math.min(x + width - 1, this.cols - 1);
    const bottom = Math.min(y + height - 1, this.rows - 1);
    this.setCell(x, y, "┌", style);
    this.setCell(right, y, "┐", style);
    this.setCell(x, bottom, "└", style);
    this.setCell(right, bottom, "┘", style);
    for (let col = x + 1; col < right; col++) {
      this.setCell(col, y, "─", style);
      this.setCell(col, bottom, "─", style);
    }
    for (let row = y + 1; row < bottom; row++) {
      this.setCell(x, row, "│", style);
      this.setCell(right, row, "│", style);
    }
    if (title !== undefined && width > 4) {
      const maxTitleLen = width - 4;
      const truncatedTitle = title.length > maxTitleLen ? title.substring(0, maxTitleLen) : title;
      this.drawText(x + 2, y, ` ${truncatedTitle} `, { ...style, bold: true });
    }
  }

  public drawSparkline(x: number, y: number, model: SparklineChartModel): void {
    if (y < 0) return;
    if (y >= this.rows) return;
    if (model.dataPoints.length === 0) return;
    const points = model.dataPoints;
    const minVal = model.min !== undefined ? model.min : Math.min(...points);
    const maxVal = model.max !== undefined ? model.max : Math.max(...points);
    const diff = maxVal - minVal;
    const range = diff === 0 ? 1 : diff;
    const blocks = model.sparkChars !== undefined ? model.sparkChars : SPARKLINE_BLOCKS;
    const style: AnsiStyle = model.color !== undefined ? { foregroundColor: model.color } : {};
    const availableWidth = Math.min(model.width, this.cols - x);
    const startIndex = Math.max(0, points.length - availableWidth);
    const visiblePoints = points.slice(startIndex);

    for (let i = 0; i < visiblePoints.length; i++) {
      const rawPointVal = visiblePoints[i];
      const pointVal = rawPointVal !== undefined ? rawPointVal : 0;
      const normalized = Math.max(0, Math.min(1, (pointVal - minVal) / range));
      const blockIndex = Math.min(blocks.length - 1, Math.floor(normalized * blocks.length));
      const rawBlockChar = blocks[blockIndex];
      this.setCell(x + i, y, rawBlockChar !== undefined ? rawBlockChar : " ", style);
    }
  }

  public drawBarChart(x: number, y: number, model: BarChartModel): void {
    const computedMax = model.values.length > 0 ? Math.max(...model.values, 1) : 1;
    const max = model.maxValue !== undefined ? model.maxValue : computedMax;
    const style: AnsiStyle = model.color !== undefined ? { foregroundColor: model.color } : {};

    for (let i = 0; i < model.categories.length; i++) {
      const targetY = y + i;
      if (targetY >= this.rows) break;
      const rawCat = model.categories[i];
      const cat = (rawCat !== undefined ? rawCat : "").padEnd(10).substring(0, 10);
      this.drawText(x, targetY, cat, { dim: true });
      const rawVal = model.values[i];
      const val = rawVal !== undefined ? rawVal : 0;
      const barLen = Math.max(0, Math.floor((val / max) * (model.width - 16)));
      this.drawText(x + 11, targetY, "█".repeat(barLen), style);
      this.drawText(x + 12 + barLen, targetY, ` ${val.toFixed(1)}`, { bold: true });
    }
  }

  public drawHistogram(x: number, y: number, model: HistogramChartModel): void {
    const maxCount = Math.max(...model.bins.map((b) => b.count), 1);
    for (let i = 0; i < model.bins.length; i++) {
      const targetY = y + i;
      if (targetY >= this.rows) break;
      const bin = model.bins[i];
      if (bin === undefined) continue;
      const label = bin.label.padEnd(8).substring(0, 8);
      this.drawText(x, targetY, label, { dim: true });
      const barLen = Math.max(0, Math.floor((bin.count / maxCount) * (model.width - 14)));
      this.drawText(x + 9, targetY, "■".repeat(barLen), { foregroundColor: "\x1b[36m" });
      this.drawText(x + 10 + barLen, targetY, ` (${bin.count})`, { dim: true });
    }
  }

  public drawHud(snapshot: HudSnapshot): void {
    if (!this.hudConfig.enabled) return;
    const hudItems: string[] = [];
    if (this.hudConfig.showFps) hudItems.push(`FPS:${snapshot.fps.toFixed(0)}`);
    if (this.hudConfig.showLatency) hudItems.push(`LAT:${snapshot.latencyMs.toFixed(0)}ms`);
    if (this.hudConfig.showResourceUsage) {
      hudItems.push(`CPU:${snapshot.cpuUsage.toFixed(0)}%`);
      hudItems.push(`MEM:${snapshot.memoryUsageMb.toFixed(0)}MB`);
    }
    if (this.hudConfig.showContainerId && snapshot.activeContainerId !== undefined) {
      hudItems.push(`CTR:${snapshot.activeContainerId.substring(0, 8)}`);
    }
    for (const badge of snapshot.badges) hudItems.push(`${badge.label}:${badge.value}`);
    const hudText = `[ ${hudItems.join(" | ")} ]`;
    const hudX = Math.max(0, this.cols - hudText.length - 1);
    this.drawText(hudX, 0, hudText, {
      bold: true,
      foregroundColor: "\x1b[33m",
      backgroundColor: "\x1b[40m",
    });
  }

  public renderToString(): string {
    let output = "";
    let activeStyleAnsi = "";

    for (let r = 0; r < this.rows; r++) {
      const row = this.currentGrid[r];
      if (row === undefined) continue;
      for (let c = 0; c < this.cols; c++) {
        const cell = row[c];
        if (cell === undefined) continue;
        const cellStyleAnsi = styleToAnsi(cell.style);
        if (cellStyleAnsi !== activeStyleAnsi) {
          output += "\x1b[0m" + cellStyleAnsi;
          activeStyleAnsi = cellStyleAnsi;
        }
        output += cell.char;
      }
      if (r < this.rows - 1) output += "\n";
    }
    if (activeStyleAnsi.length > 0) output += "\x1b[0m";
    return output;
  }

  public computeDelta(): FrameDelta {
    const changedCells: CellDelta[] = [];
    for (let r = 0; r < this.rows; r++) {
      const currRow = this.currentGrid[r];
      const prevRow = this.previousGrid[r];
      if (currRow === undefined) continue;
      if (prevRow === undefined) continue;
      for (let c = 0; c < this.cols; c++) {
        const current = currRow[c];
        const prev = prevRow[c];
        if (current === undefined) continue;
        if (prev === undefined) continue;
        const charChanged = current.char !== prev.char;
        const styleChanged = JSON.stringify(current.style) !== JSON.stringify(prev.style);
        if (charChanged) {
          changedCells.push({ x: c, y: r, char: current.char, style: current.style });
        } else if (styleChanged) {
          changedCells.push({ x: c, y: r, char: current.char, style: current.style });
        }
      }
    }
    return {
      frameId: ++this.frameSequence,
      previousFrameId: this.frameSequence - 1,
      timestamp: Date.now(),
      changedCells,
    };
  }

  public snapshot(isKeyframe: boolean = false): CanvasFrame {
    const startTime = performance.now();
    const rendered = this.renderToString();
    const delta = this.computeDelta();
    let frameData: string;

    if (isKeyframe) {
      frameData = rendered;
    } else if (this.compressionFormat === "raw") {
      frameData = rendered;
    } else if (this.frameSequence === 1) {
      frameData = rendered;
    } else {
      frameData = JSON.stringify(delta);
    }

    for (let r = 0; r < this.rows; r++) {
      const currRow = this.currentGrid[r];
      const prevRow = this.previousGrid[r];
      if (currRow === undefined) continue;
      if (prevRow === undefined) continue;
      for (let c = 0; c < this.cols; c++) {
        const cell = currRow[c];
        if (cell !== undefined) prevRow[c] = { char: cell.char, style: cell.style, dirty: false };
      }
    }

    const durationMs = performance.now() - startTime;
    const rawBytes = rendered.length;
    const compressedBytes = frameData.length;
    const stats: FrameStats = {
      renderDurationMs: durationMs,
      compressionRatio: rawBytes > 0 ? compressedBytes / rawBytes : 1.0,
      dirtyCellCount: delta.changedCells.length,
      totalBytes: compressedBytes,
    };
    const finalKeyframe = isKeyframe ? true : this.frameSequence === 1;

    return {
      frameId: this.frameSequence,
      timestamp: Date.now(),
      sequence: this.frameSequence,
      cols: this.cols,
      rows: this.rows,
      format: this.compressionFormat,
      data: frameData,
      isKeyframe: finalKeyframe,
      checksum: computeFnv1a(frameData),
      stats,
    };
  }

  public start(): void {
    if (this.isStreaming) return;
    this.isStreaming = true;
    const intervalMs = Math.max(16, Math.floor(1000 / this.targetFps));
    this.timerHandle = setInterval(() => {
      try {
        const frame = this.snapshot();
        if (this.onFrameCallback !== undefined) this.onFrameCallback(frame);
      } catch (err) {
        if (this.onErrorCallback !== undefined && err instanceof Error) {
          this.onErrorCallback(err);
        }
      }
    }, intervalMs);
  }

  public stop(): void {
    if (this.timerHandle !== null) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    this.isStreaming = false;
  }
}

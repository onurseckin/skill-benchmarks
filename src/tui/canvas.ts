export interface AnsiCell {
  readonly char: string;
  readonly fg?: string;
  readonly bg?: string;
  readonly bold?: boolean;
  readonly dim?: boolean;
}

export interface BoxDimensions {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export class AnsiCanvas {
  public readonly width: number;
  public readonly height: number;
  private buffer: AnsiCell[][];

  public constructor(width = 80, height = 24) {
    this.width = Math.max(10, width);
    this.height = Math.max(5, height);
    this.buffer = this.createEmptyBuffer();
  }

  public clear(): void {
    this.buffer = this.createEmptyBuffer();
  }

  public setCell(x: number, y: number, cell: Partial<AnsiCell>): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const existing = this.buffer[y]?.[x];
    if (existing && this.buffer[y]) {
      this.buffer[y]![x] = {
        char: cell.char ?? existing.char,
        fg: cell.fg ?? existing.fg,
        bg: cell.bg ?? existing.bg,
        bold: cell.bold ?? existing.bold,
        dim: cell.dim ?? existing.dim,
      };
    }
  }

  public drawText(
    x: number,
    y: number,
    text: string,
    style: { fg?: string; bg?: string; bold?: boolean; dim?: boolean } = {}
  ): void {
    if (y < 0 || y >= this.height) return;
    let currX = x;
    for (const char of text) {
      if (currX >= this.width) break;
      if (currX >= 0) {
        this.setCell(currX, y, { char, ...style });
      }
      currX++;
    }
  }

  public drawBox(
    bounds: BoxDimensions,
    title?: string,
    style: { fg?: string; bold?: boolean; double?: boolean } = {}
  ): void {
    const { x, y, width, height } = bounds;
    const tl = style.double ? "╔" : "┌";
    const tr = style.double ? "╗" : "┐";
    const bl = style.double ? "╚" : "└";
    const br = style.double ? "╝" : "┘";
    const h = style.double ? "═" : "─";
    const v = style.double ? "║" : "│";

    for (let col = x + 1; col < x + width - 1; col++) {
      this.setCell(col, y, { char: h, ...style });
      this.setCell(col, y + height - 1, { char: h, ...style });
    }

    for (let row = y + 1; row < y + height - 1; row++) {
      this.setCell(x, row, { char: v, ...style });
      this.setCell(x + width - 1, row, { char: v, ...style });
    }

    this.setCell(x, y, { char: tl, ...style });
    this.setCell(x + width - 1, y, { char: tr, ...style });
    this.setCell(x, y + height - 1, { char: bl, ...style });
    this.setCell(x + width - 1, y + height - 1, { char: br, ...style });

    if (title && width > title.length + 4) {
      this.drawText(x + 2, y, ` ${title} `, { ...style, bold: true });
    }
  }

  public drawSplitPane(
    bounds: BoxDimensions,
    leftTitle: string,
    rightTitle: string,
    splitRatio = 0.5
  ): void {
    this.drawBox(bounds, undefined, { double: true });
    const splitX = Math.round(bounds.x + bounds.width * splitRatio);

    for (let row = bounds.y + 1; row < bounds.y + bounds.height - 1; row++) {
      this.setCell(splitX, row, { char: "│", dim: true });
    }
    this.setCell(splitX, bounds.y, { char: "╤" });
    this.setCell(splitX, bounds.y + bounds.height - 1, { char: "╧" });

    this.drawText(bounds.x + 2, bounds.y, ` ${leftTitle} `, { bold: true });
    this.drawText(splitX + 2, bounds.y, ` ${rightTitle} `, { bold: true });
  }

  public drawProgressBar(
    x: number,
    y: number,
    width: number,
    progress: number,
    label?: string
  ): void {
    const clamped = Math.max(0, Math.min(1, progress));
    const innerWidth = width - 2;
    const filled = Math.round(clamped * innerWidth);
    const empty = Math.max(0, innerWidth - filled);

    this.setCell(x, y, { char: "[" });
    for (let i = 0; i < filled; i++) {
      this.setCell(x + 1 + i, y, { char: "█" });
    }
    for (let i = 0; i < empty; i++) {
      this.setCell(x + 1 + filled + i, y, { char: "░", dim: true });
    }
    this.setCell(x + width - 1, y, { char: "]" });

    if (label) {
      this.drawText(x + width + 1, y, label, { bold: true });
    }
  }

  public renderToString(): string {
    const lines: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let lineStr = "";
      for (let x = 0; x < this.width; x++) {
        const cell = this.buffer[y]?.[x];
        lineStr += cell ? cell.char : " ";
      }
      lines.push(lineStr);
    }
    return lines.join("\n");
  }

  public flushToStdout(): void {
    process.stdout.write("\u001b[H" + this.renderToString() + "\n");
  }

  private createEmptyBuffer(): AnsiCell[][] {
    return Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => ({ char: " " }))
    );
  }
}

export function createAnsiCanvas(width = 80, height = 24): AnsiCanvas {
  return new AnsiCanvas(width, height);
}

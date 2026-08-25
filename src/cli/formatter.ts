import type {
  MetricCard,
  ProgressBarOptions,
  StatusBadgeStatus,
  TableColumn,
  TableRenderOptions,
} from "./types.js";

const ESC = "\u001B[";
const RESET_CODE = "\u001B[0m";
const ANSI_REGEX = /\u001B\[[0-9;]*[a-zA-Z]/g;

function applyAnsi(code: number, resetCode: number, text: string): string {
  return `${ESC}${code}m${text}${ESC}${resetCode}m`;
}

export function bold(text: string): string {
  return applyAnsi(1, 22, text);
}

export function dim(text: string): string {
  return applyAnsi(2, 22, text);
}

export function italic(text: string): string {
  return applyAnsi(3, 23, text);
}

export function underline(text: string): string {
  return applyAnsi(4, 24, text);
}

export function red(text: string): string {
  return applyAnsi(31, 39, text);
}

export function green(text: string): string {
  return applyAnsi(32, 39, text);
}

export function yellow(text: string): string {
  return applyAnsi(33, 39, text);
}

export function blue(text: string): string {
  return applyAnsi(34, 39, text);
}

export function magenta(text: string): string {
  return applyAnsi(35, 39, text);
}

export function cyan(text: string): string {
  return applyAnsi(36, 39, text);
}

export function white(text: string): string {
  return applyAnsi(37, 39, text);
}

export function gray(text: string): string {
  return applyAnsi(90, 39, text);
}

export function reset(text?: string): string {
  if (text === undefined || text === "") {
    return RESET_CODE;
  }
  return `${RESET_CODE}${text}${RESET_CODE}`;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

export function stringWidth(text: string): number {
  return stripAnsi(text).length;
}

function truncateString(text: string, maxWidth: number): string {
  const stripped = stripAnsi(text);
  if (stripped.length <= maxWidth) {
    return text;
  }
  if (maxWidth <= 1) {
    return "…";
  }
  return stripped.slice(0, maxWidth - 1) + "…";
}

function padCell(text: string, width: number, align: "left" | "center" | "right" = "left"): string {
  const visualLength = stringWidth(text);
  const totalPadding = Math.max(0, width - visualLength);
  if (align === "right") {
    return " ".repeat(totalPadding) + text;
  }
  if (align === "center") {
    const leftPad = Math.floor(totalPadding / 2);
    const rightPad = totalPadding - leftPad;
    return " ".repeat(leftPad) + text + " ".repeat(rightPad);
  }
  return text + " ".repeat(totalPadding);
}

function getCellValue<T>(column: TableColumn<T>, row: T): string {
  const record = row as Record<string, unknown>;
  const key = column.key as string;
  const rawValue = record[key];
  if (column.formatter !== undefined) {
    return column.formatter(rawValue, row);
  }
  if (rawValue === null || rawValue === undefined) {
    return "";
  }
  return String(rawValue);
}

export function formatTable<T>(
  columns: readonly TableColumn<T>[],
  data: readonly T[],
  options?: Partial<TableRenderOptions<T>>
): string {
  if (columns.length === 0) {
    return options?.title !== undefined ? bold(options.title) : "";
  }

  const showBorders = options?.showBorders !== false;
  const maxColWidth = options?.maxColumnWidth;

  const columnWidths: number[] = [];
  for (const col of columns) {
    let width = stringWidth(col.header);
    if (col.width !== undefined && col.width > width) {
      width = col.width;
    }
    for (const row of data) {
      const cellValue = getCellValue(col, row);
      const cellText = maxColWidth !== undefined ? truncateString(cellValue, maxColWidth) : cellValue;
      const cellLength = stringWidth(cellText);
      if (cellLength > width) {
        width = cellLength;
      }
    }
    if (maxColWidth !== undefined && width > maxColWidth) {
      width = maxColWidth;
    }
    columnWidths.push(Math.max(width, 1));
  }

  const lines: string[] = [];

  if (options?.title !== undefined && options.title.length > 0) {
    lines.push(bold(cyan(options.title)));
  }

  if (showBorders) {
    const topSegments = columnWidths.map((w) => "─".repeat(w + 2));
    lines.push(gray(`┌${topSegments.join("┬")}┐`));

    const headerCells = columns.map((col, idx) => {
      const w = columnWidths[idx] ?? 0;
      const padded = padCell(bold(col.header), w, col.align ?? "left");
      return ` ${padded} `;
    });
    lines.push(gray("│") + headerCells.join(gray("│")) + gray("│"));

    const midSegments = columnWidths.map((w) => "─".repeat(w + 2));
    lines.push(gray(`├${midSegments.join("┼")}┤`));

    for (const row of data) {
      const rowCells = columns.map((col, idx) => {
        const w = columnWidths[idx] ?? 0;
        const raw = getCellValue(col, row);
        const cellText = maxColWidth !== undefined ? truncateString(raw, maxColWidth) : raw;
        const padded = padCell(cellText, w, col.align ?? "left");
        return ` ${padded} `;
      });
      lines.push(gray("│") + rowCells.join(gray("│")) + gray("│"));
    }

    const botSegments = columnWidths.map((w) => "─".repeat(w + 2));
    lines.push(gray(`└${botSegments.join("┴")}┘`));
  } else {
    const headerCells = columns.map((col, idx) => {
      const w = columnWidths[idx] ?? 0;
      return padCell(bold(col.header), w, col.align ?? "left");
    });
    lines.push(headerCells.join("  "));

    const sepCells = columnWidths.map((w) => "─".repeat(w));
    lines.push(gray(sepCells.join("  ")));

    for (const row of data) {
      const rowCells = columns.map((col, idx) => {
        const w = columnWidths[idx] ?? 0;
        const raw = getCellValue(col, row);
        const cellText = maxColWidth !== undefined ? truncateString(raw, maxColWidth) : raw;
        return padCell(cellText, w, col.align ?? "left");
      });
      lines.push(rowCells.join("  "));
    }
  }

  return lines.join("\n");
}

function formatStatusValue(status?: "success" | "warning" | "error" | "info" | "neutral", valueStr: string = ""): string {
  switch (status) {
    case "success":
      return green(bold(valueStr));
    case "warning":
      return yellow(bold(valueStr));
    case "error":
      return red(bold(valueStr));
    case "info":
      return cyan(bold(valueStr));
    case "neutral":
    default:
      return bold(valueStr);
  }
}

function formatChangeIndicator(change?: string): string {
  if (change === undefined || change.length === 0) {
    return "";
  }
  if (change.startsWith("+")) {
    return ` (${green(change)})`;
  }
  if (change.startsWith("-")) {
    return ` (${red(change)})`;
  }
  return ` (${gray(change)})`;
}

export function formatMetricCards(cards: readonly MetricCard[]): string {
  if (cards.length === 0) {
    return "";
  }

  const renderedCards = cards.map((card) => {
    const valText = String(card.value);
    const valueWithChange = `${valText}${card.change !== undefined ? ` (${card.change})` : ""}`;
    const titleLen = stringWidth(card.title);
    const valLen = stringWidth(valueWithChange);
    const subLen = card.subtitle !== undefined ? stringWidth(card.subtitle) : 0;
    const contentWidth = Math.max(16, titleLen, valLen, subLen);
    const boxWidth = contentWidth + 2;

    const formattedVal = formatStatusValue(card.status, valText) + formatChangeIndicator(card.change);
    const formattedSub = card.subtitle !== undefined ? dim(card.subtitle) : "";

    const top = gray(`┌${"─".repeat(boxWidth)}┐`);
    const line1 = `${gray("│")} ${padCell(bold(card.title), contentWidth, "left")} ${gray("│")}`;
    const line2 = `${gray("│")} ${padCell(formattedVal, contentWidth, "left")} ${gray("│")}`;
    const line3 = `${gray("│")} ${padCell(formattedSub, contentWidth, "left")} ${gray("│")}`;
    const bot = gray(`└${"─".repeat(boxWidth)}┘`);

    return [top, line1, line2, line3, bot];
  });

  const outputLines: string[] = [];
  const lineCount = 5;
  for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
    const mergedLine = renderedCards
      .map((cardLines) => cardLines[lineIdx] ?? "")
      .join("  ");
    outputLines.push(mergedLine);
  }

  return outputLines.join("\n");
}

export function formatProgressBar(options: ProgressBarOptions): string {
  const barWidth = options.width !== undefined && options.width > 0 ? options.width : 20;
  const clampedCurrent = Math.max(0, options.current);
  const total = Math.max(0, options.total);
  const ratio = total > 0 ? Math.min(1, clampedCurrent / total) : 0;
  const percentage = (ratio * 100).toFixed(1);
  const filledCount = Math.round(ratio * barWidth);
  const emptyCount = Math.max(0, barWidth - filledCount);

  const filledChars = "█".repeat(filledCount);
  const coloredFilled = ratio >= 1 ? green(filledChars) : cyan(filledChars);
  const emptyChars = gray("░".repeat(emptyCount));
  const bar = `[${coloredFilled}${emptyChars}]`;

  const percentText = `${percentage.padStart(5, " ")}%`;
  const countText = `(${options.current}/${options.total})`;
  const labelPrefix = options.label !== undefined && options.label.length > 0 ? `${bold(options.label)} ` : "";
  const statusSuffix = options.statusText !== undefined && options.statusText.length > 0 ? ` - ${dim(options.statusText)}` : "";

  return `${labelPrefix}${bar} ${percentText} ${countText}${statusSuffix}`;
}

export function formatBadge(status: StatusBadgeStatus, customText?: string): string {
  switch (status) {
    case "success":
      return green(bold(`[ ${customText ?? "PASS"} ]`));
    case "error":
      return red(bold(`[ ${customText ?? "FAIL"} ]`));
    case "warning":
      return yellow(bold(`[ ${customText ?? "WARN"} ]`));
    case "info":
      return cyan(bold(`[ ${customText ?? "INFO"} ]`));
    case "running":
      return cyan(bold(`[ ${customText ?? "RUNNING"} ]`));
    case "skipped":
      return gray(bold(`[ ${customText ?? "SKIP"} ]`));
    case "neutral":
      return gray(bold(`[ ${customText ?? "NEUTRAL"} ]`));
  }
}

export function formatError(error: unknown, verbose: boolean = false): string {
  const prefix = red(bold("Error:"));
  const summary = error instanceof TypeError
    ? "Command input or configuration is invalid. Verify flags, paths, and required local files."
    : "Command failed. Verify local configuration and retry.";
  const guidance = verbose ? `\n${dim("Raw exception details are not printed on public CLI surfaces.")}` : "";
  return `${prefix} ${red(summary)}${guidance}`;
}

export function formatKeyValueList(pairs: readonly (readonly [string, string])[]): string {
  if (pairs.length === 0) {
    return "";
  }
  let maxKeyLength = 0;
  for (const [key] of pairs) {
    const len = stringWidth(key);
    if (len > maxKeyLength) {
      maxKeyLength = len;
    }
  }
  return pairs
    .map(([key, value]) => {
      const paddedKey = key.padEnd(maxKeyLength);
      return `  ${bold(cyan(paddedKey))}  ${gray(":")}  ${value}`;
    })
    .join("\n");
}

export function formatSectionHeader(title: string): string {
  const prefix = "─── ";
  const suffix = " ";
  const totalLength = 60;
  const contentWidth = stringWidth(title);
  const remainingDashes = Math.max(3, totalLength - contentWidth - stringWidth(prefix) - stringWidth(suffix));
  const line = gray("─".repeat(remainingDashes));
  return `\n${bold(cyan(prefix + title + suffix))}${line}`;
}

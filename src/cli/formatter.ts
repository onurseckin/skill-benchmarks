const escapeSequence = "\u001B[";
const resetSequence = "\u001B[0m";
const escapeCharacter = String.fromCharCode(27);
const ansiPattern = new RegExp(`${escapeCharacter}\\[[0-9;]*[a-zA-Z]`, "g");

function colorEnabled(): boolean {
  return (
    process.stdout.isTTY === true && !Object.prototype.hasOwnProperty.call(process.env, "NO_COLOR")
  );
}

function applyAnsi(code: number, resetCode: number, text: string): string {
  return colorEnabled() ? `${escapeSequence}${code}m${text}${escapeSequence}${resetCode}m` : text;
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
  if (!colorEnabled()) return text ?? "";
  return text === undefined || text === ""
    ? resetSequence
    : `${resetSequence}${text}${resetSequence}`;
}

export function stripAnsi(text: string): string {
  return text.replace(ansiPattern, "");
}

export function stringWidth(text: string): number {
  return stripAnsi(text).length;
}

export type StatusBadgeStatus =
  | "success"
  | "error"
  | "warning"
  | "info"
  | "running"
  | "skipped"
  | "neutral";

export function formatBadge(status: StatusBadgeStatus, customText?: string): string {
  const text = `[ ${customText ?? defaultBadgeText(status)} ]`;
  if (status === "success") return green(bold(text));
  if (status === "error") return red(bold(text));
  if (status === "warning") return yellow(bold(text));
  if (status === "info" || status === "running") return cyan(bold(text));
  return gray(bold(text));
}

function defaultBadgeText(status: StatusBadgeStatus): string {
  if (status === "success") return "PASS";
  if (status === "error") return "FAIL";
  if (status === "warning") return "WARN";
  if (status === "info") return "INFO";
  if (status === "running") return "RUNNING";
  if (status === "skipped") return "SKIP";
  return "NEUTRAL";
}

export function formatSectionHeader(title: string): string {
  const prefix = "─── ";
  const suffix = " ";
  const remaining = Math.max(
    3,
    60 - stringWidth(title) - stringWidth(prefix) - stringWidth(suffix),
  );
  return `\n${bold(cyan(prefix + title + suffix))}${gray("─".repeat(remaining))}`;
}

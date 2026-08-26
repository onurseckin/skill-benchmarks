import type { AnsiColorValue, AnsiStyle, RgbColor } from "./types.js";

function isRgbColor(color: AnsiColorValue): color is RgbColor {
  return (
    typeof color === "object" && color !== null && "r" in color && "g" in color && "b" in color
  );
}

function colorToAnsiForeground(color?: AnsiColorValue): string {
  if (color === undefined || color === null) return "";
  if (typeof color === "string") return color;
  if (typeof color === "number") return `\x1b[38;5;${color}m`;
  if (isRgbColor(color)) return `\x1b[38;2;${color.r};${color.g};${color.b}m`;
  return "";
}

function colorToAnsiBackground(color?: AnsiColorValue): string {
  if (color === undefined || color === null) return "";
  if (typeof color === "string") return color;
  if (typeof color === "number") return `\x1b[48;5;${color}m`;
  if (isRgbColor(color)) return `\x1b[48;2;${color.r};${color.g};${color.b}m`;
  return "";
}

export function styleToAnsi(style?: AnsiStyle): string {
  if (style === undefined || style === null) return "";
  let output = "";
  if (style.bold) output += "\x1b[1m";
  if (style.dim) output += "\x1b[2m";
  if (style.italic) output += "\x1b[3m";
  if (style.underline) output += "\x1b[4m";
  if (style.blink) output += "\x1b[5m";
  if (style.inverse) output += "\x1b[7m";
  if (style.hidden) output += "\x1b[8m";
  if (style.strikethrough) output += "\x1b[9m";
  if (style.foregroundColor !== undefined) output += colorToAnsiForeground(style.foregroundColor);
  if (style.backgroundColor !== undefined) output += colorToAnsiBackground(style.backgroundColor);
  return output;
}

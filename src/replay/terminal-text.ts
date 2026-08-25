const operatingSystemCommand = /(?:\u001B\]|\u009D)[\s\S]*?(?:\u0007|\u001B\\|$)/g;
const terminalControlString = /(?:\u001B[P^_X]|[\u0090\u0098\u009E\u009F])[\s\S]*?(?:\u0007|\u001B\\|$)/g;
const controlSequence = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/g;
const escapeSequence = /\u001B[@-_]/g;
const controlCharacters = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

export function sanitizeTerminalText(value: string): string {
  return value
    .replace(operatingSystemCommand, "")
    .replace(terminalControlString, "")
    .replace(controlSequence, "")
    .replace(escapeSequence, "")
    .replace(controlCharacters, "");
}

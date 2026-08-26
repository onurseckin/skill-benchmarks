const escapeCharacter = String.fromCharCode(27);
const bellCharacter = String.fromCharCode(7);
const deviceControlStringCharacter = String.fromCharCode(144);
const controlSequenceIntroducerCharacter = String.fromCharCode(155);
const operatingSystemCommandCharacter = String.fromCharCode(157);
const startOfStringCharacter = String.fromCharCode(152);
const privacyMessageCharacter = String.fromCharCode(158);
const applicationProgramCommandCharacter = String.fromCharCode(159);
const stringTerminator = `${escapeCharacter}\\\\`;
const operatingSystemCommand = new RegExp(
  `(?:${escapeCharacter}\\]|${operatingSystemCommandCharacter})[\\s\\S]*?(?:${bellCharacter}|${stringTerminator}|$)`,
  "g",
);
const terminalControlString = new RegExp(
  `(?:${escapeCharacter}[P^_X]|[${deviceControlStringCharacter}${startOfStringCharacter}${privacyMessageCharacter}${applicationProgramCommandCharacter}])[\\s\\S]*?(?:${bellCharacter}|${stringTerminator}|$)`,
  "g",
);
const controlSequence = new RegExp(
  `(?:${escapeCharacter}\\[|${controlSequenceIntroducerCharacter})[0-?]*[ -/]*[@-~]`,
  "g",
);
const escapeSequence = new RegExp(`${escapeCharacter}[@-_]`, "g");

function removeControlCharacters(value: string): string {
  let sanitized = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 8 || (code >= 11 && code <= 31) || (code >= 127 && code <= 159)) {
      continue;
    }
    sanitized += character;
  }
  return sanitized;
}

export function sanitizeTerminalText(value: string): string {
  const terminalSequencesRemoved = value
    .replace(operatingSystemCommand, "")
    .replace(terminalControlString, "")
    .replace(controlSequence, "")
    .replace(escapeSequence, "");
  return removeControlCharacters(terminalSequencesRemoved);
}

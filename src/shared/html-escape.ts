export function escapeHtmlText(value: string): string {
  return exposeBidirectionalControls(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replace(/[\r\n\t]/g, " ");
}

export function serializeEmbeddedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(bidirectionalControls, (character) => `\\\\u${character.codePointAt(0)?.toString(16).padStart(4, "0")}`);
}

const bidirectionalControls = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function exposeBidirectionalControls(value: string): string {
  return value.replace(bidirectionalControls, (character) => `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0")}`);
}

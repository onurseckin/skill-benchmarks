import { createHash } from "node:crypto";

export function createContentSecurityPolicy(html: string): string {
  const hashes = extractExecutableScripts(html).map(
    (script) => `'sha256-${createHash("sha256").update(script).digest("base64")}'`,
  );
  const scriptSource = hashes.length === 0 ? "'none'" : hashes.join(" ");
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src ${scriptSource}`,
  ].join("; ");
}

export function createContentSecurityPolicyMeta(htmlWithoutPolicy: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(createContentSecurityPolicy(htmlWithoutPolicy))}">`;
}

function extractExecutableScripts(html: string): readonly string[] {
  const scripts: string[] = [];
  const pattern = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1] ?? "";
    if (/\btype\s*=\s*["']application\/json["']/i.test(attributes)) continue;
    scripts.push(match[2] ?? "");
  }
  return scripts;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

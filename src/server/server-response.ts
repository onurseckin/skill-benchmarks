import { createContentSecurityPolicy } from "../shared/html-content-security.js";
import type { ApiSuccessResponse, ServerErrorBody, ServerErrorCode } from "./types.js";

const errorMessages: Readonly<Record<ServerErrorCode, string>> = Object.freeze({
  invalid_request: "The request is invalid.",
  method_not_allowed: "The request method is not supported.",
  route_not_found: "The requested route was not found.",
  run_not_found: "The requested run was not found.",
  replay_unavailable: "Replay evidence is unavailable.",
  replay_invalid: "Replay evidence is invalid.",
  internal_error: "The request could not be completed.",
});

const securityHeaders: Readonly<Record<string, string>> = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
});

export function jsonResponse<T>(
  data: T,
  status = 200,
  headers?: Readonly<Record<string, string>>,
): Response {
  const body: ApiSuccessResponse<T> = {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders("application/json; charset=utf-8", headers),
  });
}

export function errorResponse(
  code: ServerErrorCode,
  status: number,
  headers?: Readonly<Record<string, string>>,
): Response {
  const body: ServerErrorBody = {
    success: false,
    error: { code, message: errorMessages[code] },
    timestamp: new Date().toISOString(),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders("application/json; charset=utf-8", headers),
  });
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: responseHeaders("text/html; charset=utf-8", {
      "Content-Security-Policy": createContentSecurityPolicy(html),
    }),
  });
}

export function headResponse(response: Response): Response {
  return new Response(null, { status: response.status, headers: response.headers });
}

function responseHeaders(
  contentType: string,
  additional?: Readonly<Record<string, string>>,
): Headers {
  return new Headers({ "Content-Type": contentType, ...securityHeaders, ...additional });
}

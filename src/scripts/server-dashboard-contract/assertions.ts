export function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new TypeError(code);
}

export async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json();
  requireCondition(typeof value === "object" && value !== null && !Array.isArray(value), "response_json_invalid");
  return value as Record<string, unknown>;
}

export function requireSecureHeaders(response: Response): void {
  requireCondition(response.headers.get("access-control-allow-origin") === null, "cors_header_present");
  requireCondition(response.headers.get("cache-control") === "no-store", "cache_header_invalid");
  requireCondition(response.headers.get("x-content-type-options") === "nosniff", "content_type_header_invalid");
  requireCondition(response.headers.get("referrer-policy") === "no-referrer", "referrer_header_invalid");
  requireCondition(response.headers.get("cross-origin-resource-policy") === "same-origin", "resource_policy_invalid");
}

export async function requireError(response: Response, status: number, code: string): Promise<void> {
  requireCondition(response.status === status, `${code}_status_invalid`);
  requireSecureHeaders(response);
  const body = await readJson(response);
  const error = body.error;
  requireCondition(typeof error === "object" && error !== null && !Array.isArray(error), `${code}_body_invalid`);
  requireCondition((error as Record<string, unknown>).code === code, `${code}_code_invalid`);
}

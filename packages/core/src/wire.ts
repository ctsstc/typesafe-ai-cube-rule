import type { CubeResponse } from "./questions";

export const CLASSIFY_ERROR_CODES = {
  bad_request: 400,
  challenge_required: 401,
  not_found: 404,
  method_not_allowed: 405,
  rate_limited: 429,
  daily_limit: 503,
  upstream_busy: 503,
  upstream_error: 502,
  timeout: 504,
  internal: 500,
} as const;
export type ClassifyErrorCode = keyof typeof CLASSIFY_ERROR_CODES;
export type ClassifyErrorStatus = (typeof CLASSIFY_ERROR_CODES)[ClassifyErrorCode];

export type ClassifyResponse = CubeResponse & { readonly mock?: true };

// A hover prefetch sends this header. The Function then serves only stored rulings and answers a
// miss with 204, so a prefetch never starts a human check or spends a Jev call.
export const PREFETCH_HEADER = "X-Cube-Prefetch";

// The SPA aborts any API request after this long. Every server-side deadline must stay under it,
// or the browser shows its own timeout instead of the Function's error.
export const CLIENT_TIMEOUT_MS = 10_000;

export interface ClassifyErrorBody {
  readonly error: { readonly code: ClassifyErrorCode; readonly message: string };
}

export function isClassifyErrorCode(value: unknown): value is ClassifyErrorCode {
  return typeof value === "string" && Object.hasOwn(CLASSIFY_ERROR_CODES, value);
}

export function isClassifyErrorBody(value: unknown): value is ClassifyErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const { error } = value;
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    isClassifyErrorCode(error.code) &&
    "message" in error &&
    typeof error.message === "string"
  );
}

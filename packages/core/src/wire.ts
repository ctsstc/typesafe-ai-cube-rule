import type { CubeResponse } from "./questions";

export const CLASSIFY_ERROR_CODES = {
  bad_request: 400,
  rate_limited: 429,
  upstream_busy: 503,
  upstream_error: 502,
  timeout: 504,
  internal: 500,
} as const;
export type ClassifyErrorCode = keyof typeof CLASSIFY_ERROR_CODES;
export type ClassifyErrorStatus = (typeof CLASSIFY_ERROR_CODES)[ClassifyErrorCode];

export type ClassifyResponse = CubeResponse & { readonly mock?: true };

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

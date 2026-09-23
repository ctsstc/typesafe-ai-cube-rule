import { CLASSIFY_ERROR_CODES, type ClassifyErrorBody, type ClassifyErrorCode } from "@cube/core";

export const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
export const CACHE_NONE = "no-store";

export type CacheStatus = "MISS" | "HIT" | "KV";

// _headers does not apply to Function responses, so the API sets its own.
const BASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
} as const;

const ERROR_MESSAGES: Record<ClassifyErrorCode, string> = {
  bad_request: "That is not a canonical classify request.",
  challenge_required: "New rulings need a quick human check first.",
  not_found: "No such API route.",
  method_not_allowed: "That method is not supported here.",
  stale_client: "This page is from another version of the oracle. Reload it.",
  rate_limited: "Too many new rulings at once. Try again in a moment.",
  daily_limit: "The oracle has used up today's new rulings. Cached foods still work.",
  upstream_busy: "Jev is busy right now. Try again shortly.",
  upstream_error: "Jev could not rule on that right now.",
  timeout: "Jev took too long to rule. Try again.",
  internal: "Something went wrong on our side.",
};

export function jsonResponse(
  body: string,
  {
    status = 200,
    cacheControl,
    cache,
    headers,
  }: {
    status?: number;
    cacheControl: string;
    cache?: CacheStatus;
    headers?: Record<string, string>;
  },
): Response {
  return new Response(body, {
    status,
    headers: {
      ...BASE_HEADERS,
      "Cache-Control": cacheControl,
      ...(cache ? { "X-Cube-Cache": cache } : {}),
      ...headers,
    },
  });
}

export function noContent(headers: Record<string, string>): Response {
  const { "Content-Type": _json, ...base } = BASE_HEADERS;
  return new Response(null, {
    status: 204,
    headers: { ...base, "Cache-Control": CACHE_NONE, ...headers },
  });
}

export function errorResponse(
  code: ClassifyErrorCode,
  {
    status = CLASSIFY_ERROR_CODES[code],
    message = ERROR_MESSAGES[code],
    headers,
  }: {
    status?: number;
    message?: string;
    headers?: Record<string, string>;
  } = {},
): Response {
  const body: ClassifyErrorBody = { error: { code, message } };
  return jsonResponse(JSON.stringify(body), { status, cacheControl: CACHE_NONE, headers });
}

import {
  CLIENT_TIMEOUT_MS,
  type ClassifyErrorCode,
  type ClassifyResponse,
  classifyUrl,
  isClassifyErrorBody,
  PREFETCH_HEADER,
} from "@cube/core";

export const SESSION_URL = "/api/session";

export type RulingErrorCode = ClassifyErrorCode | "offline" | "network";

export class RulingError extends Error {
  constructor(
    readonly code: RulingErrorCode,
    readonly retryAfter: number | null = null,
  ) {
    super(code);
    this.name = "RulingError";
  }
}

export interface Classified {
  readonly response: ClassifyResponse;
  readonly latencyMs: number;
  readonly cache: string | null;
  readonly fromBrowserCache: boolean;
}

const STATUS_CODES: Record<number, ClassifyErrorCode> = {
  400: "bad_request",
  401: "challenge_required",
  404: "not_found",
  405: "method_not_allowed",
  429: "rate_limited",
  502: "upstream_error",
  503: "upstream_busy",
  504: "timeout",
};

const CACHE_HEADERS = ["x-cube-cache", "cf-cache-status", "x-cache"];

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

function isClassifyResponse(value: unknown): value is ClassifyResponse {
  if (typeof value !== "object" || value === null) return false;
  const { model, answers } = value as { model?: unknown; answers?: unknown };
  if (typeof model !== "string" || typeof answers !== "object" || answers === null) return false;
  const a = answers as Record<string, { probabilities?: unknown; noul?: unknown } | undefined>;
  return (
    typeof a.category?.probabilities === "object" &&
    typeof a.input_kind?.probabilities === "object" &&
    typeof a.is_abusive?.noul === "number"
  );
}

function servedFromBrowserCache(url: string): boolean {
  try {
    const entries = performance.getEntriesByName(new URL(url, location.href).href, "resource");
    const last = entries.at(-1) as PerformanceResourceTiming | undefined;
    return last !== undefined && last.transferSize === 0 && last.decodedBodySize > 0;
  } catch {
    return false;
  }
}

async function send(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    if (controller.signal.aborted) throw new RulingError("timeout");
    throw new RulingError(navigator.onLine === false ? "offline" : "network");
  } finally {
    clearTimeout(timer);
  }
}

function failure(res: Response, body: unknown): RulingError {
  const code = isClassifyErrorBody(body)
    ? body.error.code
    : (STATUS_CODES[res.status] ?? "internal");
  return new RulingError(code, parseRetryAfter(res.headers.get("retry-after")));
}

async function request(item: string, prefetch = false): Promise<Classified | null> {
  const url = classifyUrl(item);
  const started = performance.now();
  const headers: Record<string, string> = { accept: "application/json" };
  if (prefetch) headers[PREFETCH_HEADER] = "1";
  const res = await send(url, { headers });
  if (prefetch && res.status === 204) return null;
  const body: unknown = await res.json().catch(() => null);
  const latencyMs = Math.round(performance.now() - started);
  if (!res.ok) throw failure(res, body);
  if (!isClassifyResponse(body)) throw new RulingError("internal");
  const cache = CACHE_HEADERS.map((name) => res.headers.get(name)).find(Boolean) ?? null;
  return { response: body, latencyMs, cache, fromBrowserCache: servedFromBrowserCache(url) };
}

async function load(item: string): Promise<Classified> {
  const result = await request(item);
  if (!result) throw new RulingError("internal");
  return result;
}

async function startSession(): Promise<void> {
  const sitekey: unknown = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  if (typeof sitekey !== "string" || !sitekey) throw new RulingError("challenge_required");
  let token: string;
  try {
    const { solveChallenge } = await import("./challenge");
    token = await solveChallenge(sitekey);
  } catch {
    throw new RulingError(navigator.onLine === false ? "offline" : "challenge_required");
  }
  const res = await send(SESSION_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw failure(res, await res.json().catch(() => null));
}

let session: Promise<void> | null = null;

// Rulings that miss together share one challenge.
function ensureSession(): Promise<void> {
  session ??= startSession().finally(() => {
    session = null;
  });
  return session;
}

async function requestWithSession(item: string): Promise<Classified> {
  try {
    return await load(item);
  } catch (error) {
    if (!(error instanceof RulingError) || error.code !== "challenge_required") throw error;
  }
  await ensureSession();
  // One retry only: a second challenge_required surfaces as an error instead of looping.
  return load(item);
}

const inflight = new Map<string, Promise<Classified>>();
const settled = new Map<string, Classified>();
const prefetching = new Map<string, Promise<Classified | null>>();

export function classify(item: string): Promise<Classified> {
  const cached = inflight.get(item);
  if (cached) return cached;
  const early = prefetching.get(item);
  const pending = early
    ? early.then((hit) => hit ?? requestWithSession(item))
    : requestWithSession(item);
  inflight.set(item, pending);
  pending.then(
    (value) => settled.set(item, value),
    () => inflight.delete(item),
  );
  return pending;
}

/** Warms the cache from stored rulings only. It never starts a human check or a Jev call. */
export function prefetch(item: string): void {
  if (settled.has(item) || inflight.has(item) || prefetching.has(item)) return;
  const pending = request(item, true)
    .then(
      (hit) => {
        if (hit) settled.set(item, hit);
        return hit;
      },
      () => null,
    )
    .finally(() => prefetching.delete(item));
  prefetching.set(item, pending);
}

export function cachedClassified(item: string): Classified | undefined {
  return settled.get(item);
}

export function clearClassifyCache(): void {
  inflight.clear();
  settled.clear();
  prefetching.clear();
}

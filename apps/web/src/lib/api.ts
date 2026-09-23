import {
  CLIENT_TIMEOUT_MS,
  type ClassifyErrorCode,
  type ClassifyResponse,
  classifyUrl,
  isClassifyErrorBody,
  isClassifyResponse,
  PREFETCH_HEADER,
  SESSION_PATH,
} from "@cube/core";

export type RulingErrorCode =
  | ClassifyErrorCode
  | "offline"
  | "network"
  | "challenge_skipped"
  | "over_capacity";

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
  409: "stale_client",
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

const NOT_JSON = Symbol("not JSON");

// Once the Free plan's daily Functions requests run out, Pages fails open and answers /api/* with
// the SPA's index.html and a 200, so a success that is not JSON means the API is over capacity.
function isHtml(res: Response): boolean {
  return /\bhtml\b/i.test(res.headers.get("content-type") ?? "");
}

async function request(item: string, prefetch = false): Promise<Classified | null> {
  const url = classifyUrl(item);
  const started = performance.now();
  const headers: Record<string, string> = { accept: "application/json" };
  if (prefetch) headers[PREFETCH_HEADER] = "1";
  const res = await send(url, { headers });
  if (prefetch && res.status === 204) return null;
  const body: unknown = await res.json().catch(() => NOT_JSON);
  const latencyMs = Math.round(performance.now() - started);
  if (!res.ok) throw failure(res, body);
  if (body === NOT_JSON || isHtml(res)) throw new RulingError("over_capacity");
  if (!isClassifyResponse(body)) throw new RulingError("internal");
  const cache = CACHE_HEADERS.map((name) => res.headers.get(name)).find(Boolean) ?? null;
  return { response: body, latencyMs, cache, fromBrowserCache: servedFromBrowserCache(url) };
}

async function load(item: string): Promise<Classified> {
  const result = await request(item);
  if (!result) throw new RulingError("internal");
  return result;
}

let checking = false;
const checkingListeners = new Set<() => void>();

function setChecking(next: boolean): void {
  if (checking === next) return;
  checking = next;
  for (const listener of checkingListeners) listener();
}

/** Whether the check card is on screen, waiting for the visitor. For useSyncExternalStore. */
export function isChecking(): boolean {
  return checking;
}

export function subscribeChecking(listener: () => void): () => void {
  checkingListeners.add(listener);
  return () => checkingListeners.delete(listener);
}

function isSkipped(error: unknown): boolean {
  return error instanceof Error && "skipped" in error && error.skipped === true;
}

async function startSession(signal: AbortSignal): Promise<void> {
  const sitekey: unknown = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  if (typeof sitekey !== "string" || !sitekey) throw new RulingError("challenge_required");
  let solveChallenge: typeof import("./challenge").solveChallenge;
  try {
    ({ solveChallenge } = await import("./challenge"));
  } catch {
    // After a deploy the old hashed chunk is gone, so only a reload can load the check.
    throw new RulingError(navigator.onLine === false ? "offline" : "stale_client");
  }
  let token: string;
  try {
    token = await solveChallenge(sitekey, { signal, onInteractive: () => setChecking(true) });
  } catch (error) {
    if (isSkipped(error)) throw new RulingError("challenge_skipped");
    throw new RulingError(navigator.onLine === false ? "offline" : "challenge_required");
  } finally {
    setChecking(false);
  }
  if (signal.aborted) throw new RulingError("challenge_skipped");
  const res = await send(SESSION_PATH, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw failure(res, await res.json().catch(() => null));
}

// Rulings that miss together share one challenge. It is abandoned once no caller waits on a ruling.
let session: { readonly done: Promise<void>; readonly controller: AbortController } | null = null;
const callers = new Map<string, number>();

function ensureSession(): Promise<void> {
  if (!session) {
    const controller = new AbortController();
    const done = startSession(controller.signal).finally(() => {
      session = null;
    });
    session = { done, controller };
  }
  return session.done;
}

function hold(item: string, pending: Promise<unknown>, signal?: AbortSignal): void {
  if (signal?.aborted) return;
  callers.set(item, (callers.get(item) ?? 0) + 1);
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    signal?.removeEventListener("abort", release);
    const left = (callers.get(item) ?? 1) - 1;
    if (left > 0) callers.set(item, left);
    else callers.delete(item);
    if (callers.size === 0) session?.controller.abort();
  };
  signal?.addEventListener("abort", release, { once: true });
  pending.then(release, release);
}

async function requestWithSession(item: string): Promise<Classified> {
  try {
    return await load(item);
  } catch (error) {
    if (!(error instanceof RulingError) || error.code !== "challenge_required") throw error;
  }
  await ensureSession();
  // Every ruling that wanted this food went away while the check ran, so do not pay for it.
  if (!callers.has(item)) throw new RulingError("challenge_skipped");
  // One retry only: a second challenge_required surfaces as an error instead of looping.
  return load(item);
}

const inflight = new Map<string, Promise<Classified>>();
const settled = new Map<string, Classified>();
const prefetching = new Map<string, Promise<Classified | null>>();

/** Rules on `item`. Aborting `signal` says this caller no longer wants the answer. */
export function classify(item: string, signal?: AbortSignal): Promise<Classified> {
  let pending = inflight.get(item);
  if (!pending) {
    const early = prefetching.get(item);
    const request = early
      ? early.then((hit) => hit ?? requestWithSession(item))
      : requestWithSession(item);
    inflight.set(item, request);
    request.then(
      (value) => settled.set(item, value),
      () => inflight.delete(item),
    );
    pending = request;
  }
  hold(item, pending, signal);
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
  callers.clear();
  session?.controller.abort();
  session = null;
}

import {
  type ClassifyErrorCode,
  type ClassifyResponse,
  classifyUrl,
  isClassifyErrorBody,
} from "@cube/core";

export const CLIENT_TIMEOUT_MS = 10_000;

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

async function request(item: string): Promise<Classified> {
  const url = classifyUrl(item);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
  } catch {
    if (controller.signal.aborted) throw new RulingError("timeout");
    throw new RulingError(navigator.onLine === false ? "offline" : "network");
  } finally {
    clearTimeout(timer);
  }
  const body: unknown = await res.json().catch(() => null);
  const latencyMs = Math.round(performance.now() - started);
  if (!res.ok) {
    const code = isClassifyErrorBody(body)
      ? body.error.code
      : (STATUS_CODES[res.status] ?? "internal");
    throw new RulingError(code, parseRetryAfter(res.headers.get("retry-after")));
  }
  if (!isClassifyResponse(body)) throw new RulingError("internal");
  const cache = CACHE_HEADERS.map((name) => res.headers.get(name)).find(Boolean) ?? null;
  return { response: body, latencyMs, cache, fromBrowserCache: servedFromBrowserCache(url) };
}

const inflight = new Map<string, Promise<Classified>>();
const settled = new Map<string, Classified>();

// One request per food per session: chips, prefetch, and back/forward never refetch.
export function classify(item: string): Promise<Classified> {
  const cached = inflight.get(item);
  if (cached) return cached;
  const pending = request(item);
  inflight.set(item, pending);
  pending.then(
    (value) => settled.set(item, value),
    () => inflight.delete(item),
  );
  return pending;
}

export function cachedClassified(item: string): Classified | undefined {
  return settled.get(item);
}

export function clearClassifyCache(): void {
  inflight.clear();
  settled.clear();
}

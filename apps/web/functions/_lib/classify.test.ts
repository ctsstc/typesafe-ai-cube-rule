// @vitest-environment node
import {
  CLIENT_TIMEOUT_MS,
  type ClassifyErrorBody,
  type ClassifyResponse,
  classifyUrl,
  isClassifyErrorBody,
  mockCubeResponse,
  PREFETCH_HEADER,
  QUESTION_SET_VERSION,
} from "@cube/core";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { onRequest as apiFallback } from "../api/[[path]]";
import { createClassifyHandler, type Env, JEV_DEADLINE_MS } from "./classify";
import { fakeD1 } from "./fake-d1";
import { createRateLimiter } from "./rate-limit";
import { issueSession, SESSION_COOKIE } from "./session";
import { CLIENT_DAILY_CALL_LIMIT, SESSION_CALL_LIMIT } from "./usage";

const ORIGIN = "https://oracle.example";
const KEY = "ts-test-key-do-not-leak";
const IMMUTABLE = "public, max-age=31536000, immutable";

type FetchMock = Mock<(url: string, init?: RequestInit) => Promise<Response>>;

let fetchMock: FetchMock;
let pending: Promise<unknown>[];
let logs: unknown[][];

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  pending = [];
  logs = [];
  for (const level of ["error", "warn", "log", "info", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args));
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const waitUntil = (promise: Promise<unknown>) => void pending.push(promise);

function call(
  path: string,
  env: Env = { TYPESAFE_API_KEY: KEY },
  { method = "GET", ip = "203.0.113.7", limit = 100 } = {},
) {
  const handler = createClassifyHandler(createRateLimiter({ limit, windowMs: 60_000 }));
  const request = new Request(`${ORIGIN}${path}`, {
    method,
    headers: { "CF-Connecting-IP": ip },
  });
  return handler(request, env, waitUntil);
}

function upstream(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function jevOk(item: string) {
  const { answers } = mockCubeResponse(item);
  return upstream(200, { model: "jev-1.13.0", answers, usage: { input_tokens: 12 } });
}

function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => void store.set(key, value)),
  };
}

function fakeCache() {
  const store = new Map<string, Response>();
  const cache = {
    store,
    match: vi.fn(async (key: Request) => store.get(key.url)?.clone()),
    put: vi.fn(async (key: Request, response: Response) => void store.set(key.url, response)),
  };
  vi.stubGlobal("caches", { default: cache });
  return cache;
}

async function errorBody(response: Response): Promise<ClassifyErrorBody> {
  const body: unknown = await response.json();
  if (!isClassifyErrorBody(body)) throw new Error(`not an error body: ${JSON.stringify(body)}`);
  return body;
}

function expectNothingLeaked(...texts: string[]) {
  const logged = JSON.stringify(logs);
  for (const text of [...texts, logged]) {
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("UPSTREAM-SECRET-DETAIL");
  }
}

it("gives up on Jev before the SPA gives up on us", () => {
  expect(JEV_DEADLINE_MS).toBeLessThan(CLIENT_TIMEOUT_MS);
});

describe("request validation", () => {
  it("rejects anything but GET with 405", async () => {
    for (const method of ["POST", "HEAD", "PUT", "OPTIONS"]) {
      const response = await call(classifyUrl("taco"), undefined, { method });
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect((await errorBody(response)).error.code).toBe("method_not_allowed");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no query", "/api/classify"],
    ["missing version", "/api/classify?food=taco"],
    ["params out of order", `/api/classify?v=${QUESTION_SET_VERSION}&food=taco`],
    ["extra param", `${classifyUrl("taco")}&x=1`],
    ["not normalized", `/api/classify?food=Hot+Dog&v=${QUESTION_SET_VERSION}`],
    ["encoded differently", `/api/classify?food=hot%20dog&v=${QUESTION_SET_VERSION}`],
    ["no usable text", `/api/classify?food=%21%21%21&v=${QUESTION_SET_VERSION}`],
  ])("returns 400 bad_request for %s", async (_label, path) => {
    const response = await call(path);
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await errorBody(response)).error.code).toBe("bad_request");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tells a tab from another deploy to reload, before looking at any cache", async () => {
    const kv = fakeKv();
    const response = await call(
      `/api/classify?food=hot+dog&v=${Number(QUESTION_SET_VERSION) - 1}`,
      {
        TYPESAFE_API_KEY: KEY,
        CLASSIFICATIONS: kv as unknown as KVNamespace,
      },
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await errorBody(response)).error.code).toBe("stale_client");
    expect(kv.get).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts the canonical URL built by classifyUrl", async () => {
    fetchMock.mockResolvedValueOnce(jevOk("hot dog"));
    const response = await call(classifyUrl("hot dog"));
    expect(response.status).toBe(200);
  });

  it("answers unknown /api paths with a JSON 404 instead of the SPA", async () => {
    const response = await apiFallback({} as Parameters<typeof apiFallback>[0]);
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect((await errorBody(response)).error.code).toBe("not_found");
  });
});

describe("mock mode", () => {
  it.each([
    ["no key", {}],
    ["blank key", { TYPESAFE_API_KEY: "  " }],
  ])("serves uncached mock rulings with %s", async (_label, env) => {
    const response = await call(classifyUrl("taco"), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as ClassifyResponse;
    expect(body).toEqual({ ...mockCubeResponse("taco"), mock: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("live rulings", () => {
  it("calls Jev once and returns only model and answers, cached immutably", async () => {
    const kv = fakeKv();
    const cache = fakeCache();
    fetchMock.mockResolvedValueOnce(jevOk("hot dog"));

    const response = await call(classifyUrl("hot dog"), {
      TYPESAFE_API_KEY: KEY,
      CLASSIFICATIONS: kv as unknown as KVNamespace,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(IMMUTABLE);
    expect(response.headers.get("X-Cube-Cache")).toBe("MISS");
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    const text = await response.text();
    const body = JSON.parse(text) as ClassifyResponse;
    expect(body).toEqual({ model: "jev-1.13.0", answers: mockCubeResponse("hot dog").answers });
    expect(body).not.toHaveProperty("usage");
    expect(body).not.toHaveProperty("mock");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${KEY}`);
    const sent = JSON.parse(String(init?.body)) as { state: unknown; model: string };
    expect(sent.state).toEqual({ item: "hot dog" });

    await Promise.all(pending);
    expect(kv.put).toHaveBeenCalledWith(`v${QUESTION_SET_VERSION}:hot dog`, text);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.put.mock.calls[0]?.[0].url).toBe(`${ORIGIN}${classifyUrl("hot dog")}`);
    expectNothingLeaked(text);
  });

  it("serves a Cache API hit without calling Jev or KV", async () => {
    const kv = fakeKv();
    const cache = fakeCache();
    fetchMock.mockResolvedValueOnce(jevOk("taco"));
    const env = { TYPESAFE_API_KEY: KEY, CLASSIFICATIONS: kv as unknown as KVNamespace };
    const first = await (await call(classifyUrl("taco"), env)).text();
    await Promise.all(pending);

    const response = await call(classifyUrl("taco"), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Cube-Cache")).toBe("HIT");
    expect(response.headers.get("Cache-Control")).toBe(IMMUTABLE);
    expect(await response.text()).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(kv.get).toHaveBeenCalledTimes(1);
    expect(cache.match).toHaveBeenCalledTimes(2);
  });

  it("serves a KV hit and refills the edge cache", async () => {
    const stored = JSON.stringify(mockCubeResponse("sushi"));
    const kv = fakeKv({ [`v${QUESTION_SET_VERSION}:sushi`]: stored });
    const cache = fakeCache();

    const response = await call(classifyUrl("sushi"), {
      TYPESAFE_API_KEY: KEY,
      CLASSIFICATIONS: kv as unknown as KVNamespace,
    });
    expect(response.headers.get("X-Cube-Cache")).toBe("KV");
    expect(response.headers.get("Cache-Control")).toBe(IMMUTABLE);
    expect(await response.text()).toBe(stored);
    expect(fetchMock).not.toHaveBeenCalled();
    await Promise.all(pending);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it("still answers when the cache and KV throw", async () => {
    const broken = vi.fn(async () => {
      throw new Error("storage down");
    });
    vi.stubGlobal("caches", { default: { match: broken, put: broken } });
    const kv = { get: broken, put: broken } as unknown as KVNamespace;
    fetchMock.mockResolvedValueOnce(jevOk("taco"));

    const response = await call(classifyUrl("taco"), {
      TYPESAFE_API_KEY: KEY,
      CLASSIFICATIONS: kv,
    });
    expect(response.status).toBe(200);
    await Promise.all(pending);
    expect(broken).toHaveBeenCalledTimes(4);
  });
});

describe("rate limiting", () => {
  it("limits live Jev calls per IP with Retry-After", async () => {
    const handler = createClassifyHandler(createRateLimiter({ limit: 1, windowMs: 60_000 }));
    const request = (item: string, ip: string) =>
      new Request(`${ORIGIN}${classifyUrl(item)}`, { headers: { "CF-Connecting-IP": ip } });
    const env = { TYPESAFE_API_KEY: KEY };
    fetchMock.mockImplementation(async () => jevOk("taco"));

    expect((await handler(request("taco", "198.51.100.1"), env, waitUntil)).status).toBe(200);
    const limited = await handler(request("pizza", "198.51.100.1"), env, waitUntil);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await errorBody(limited)).error.code).toBe("rate_limited");
    expect((await handler(request("pizza", "198.51.100.2"), env, waitUntil)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not count mock rulings", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await call(classifyUrl("taco"), {}, { limit: 1 })).status).toBe(200);
    }
  });
});

describe("upstream error mapping", () => {
  async function failWith(respond: () => Promise<Response>) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchMock.mockImplementation(respond);
    const result = call(classifyUrl("taco"));
    await vi.runAllTimersAsync();
    const response = await result;
    const text = await response.clone().text();
    expectNothingLeaked(text);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    return response;
  }

  const secret = { detail: "UPSTREAM-SECRET-DETAIL" };

  it("maps 429 to rate_limited with the upstream Retry-After, without retrying", async () => {
    const response = await failWith(async () => upstream(429, secret, { "retry-after": "7" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("7");
    expect((await errorBody(response)).error.code).toBe("rate_limited");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("defaults Retry-After when upstream sends none", async () => {
    const response = await failWith(async () => upstream(429, secret));
    expect(response.headers.get("Retry-After")).toBe("10");
  });

  it.each([529, 503])("maps %i to upstream_busy after one retry", async (status) => {
    const response = await failWith(async () => upstream(status, secret));
    expect(response.status).toBe(503);
    expect((await errorBody(response)).error.code).toBe("upstream_busy");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([500, 401, 422])("maps %i to upstream_error", async (status) => {
    const response = await failWith(async () => upstream(status, secret));
    expect(response.status).toBe(502);
    expect((await errorBody(response)).error.code).toBe("upstream_error");
  });

  it("maps a connection failure to upstream_error", async () => {
    const response = await failWith(async () => {
      throw new TypeError("fetch failed UPSTREAM-SECRET-DETAIL");
    });
    expect(response.status).toBe(502);
    expect((await errorBody(response)).error.code).toBe("upstream_error");
  });

  it("maps an attempt timeout to 504 without retrying", async () => {
    const response = await failWith(
      (_url?: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    expect(response.status).toBe(504);
    expect((await errorBody(response)).error.code).toBe("timeout");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to cache a malformed 200", async () => {
    const kv = fakeKv();
    const cache = fakeCache();
    fetchMock.mockImplementation(async () => upstream(200, { answers: "UPSTREAM-SECRET-DETAIL" }));
    const response = await call(classifyUrl("taco"), {
      TYPESAFE_API_KEY: KEY,
      CLASSIFICATIONS: kv as unknown as KVNamespace,
    });
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await errorBody(response)).error.code).toBe("upstream_error");
    await Promise.all(pending);
    expect(kv.put).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("refuses to cache a 200 that is missing an answer", async () => {
    const kv = fakeKv();
    const cache = fakeCache();
    const { answers } = mockCubeResponse("taco");
    const { debate_heat: _missing, ...partial } = answers;
    fetchMock.mockImplementation(async () =>
      upstream(200, { model: "jev-1.13.0", answers: partial }),
    );
    const response = await call(classifyUrl("taco"), {
      TYPESAFE_API_KEY: KEY,
      CLASSIFICATIONS: kv as unknown as KVNamespace,
    });
    expect(response.status).toBe(502);
    await Promise.all(pending);
    expect(kv.put).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("turns unexpected exceptions into a JSON 500", async () => {
    const handler = createClassifyHandler({
      take: () => {
        throw new Error("limiter bug");
      },
      size: () => 0,
    });
    const request = new Request(`${ORIGIN}${classifyUrl("taco")}`);
    const response = await handler(request, { TYPESAFE_API_KEY: KEY }, waitUntil);
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await errorBody(response)).error.code).toBe("internal");
  });

  it("logs the failure without the key or upstream body", async () => {
    await failWith(async () => upstream(422, secret, { "x-typesafe-request-id": "req_123" }));
    expect(logs).toContainEqual([
      "classify: Jev call failed",
      {
        code: "upstream_error",
        error: "UnprocessableEntityError",
        status: 422,
        requestId: "req_123",
      },
    ]);
  });
});

describe("challenge and spend caps", () => {
  const TURNSTILE = "1x0000000000000000000000000000000AA";
  const SESSION_SECRET = "0123456789abcdef0123456789abcdef-do-not-leak";

  function guardedEnv(overrides: Partial<Env> = {}) {
    const d1 = fakeD1();
    const env: Env = {
      TYPESAFE_API_KEY: KEY,
      TURNSTILE_SECRET_KEY: TURNSTILE,
      SESSION_SECRET,
      DB: d1.binding,
      ...overrides,
    };
    return { d1, env };
  }

  async function cookie(now = Date.now()) {
    return `${SESSION_COOKIE}=${await issueSession(SESSION_SECRET, now)}`;
  }

  function ask(item: string, env: Env, sessionCookie?: string, extra: Record<string, string> = {}) {
    const handler = createClassifyHandler(createRateLimiter({ limit: 100, windowMs: 60_000 }));
    const headers: Record<string, string> = { "CF-Connecting-IP": "203.0.113.7", ...extra };
    if (sessionCookie) headers.Cookie = sessionCookie;
    return handler(new Request(`${ORIGIN}${classifyUrl(item)}`, { headers }), env, waitUntil);
  }

  const usage = (d1: ReturnType<typeof fakeD1>) =>
    d1.sqlite.prepare("SELECT day, calls FROM usage").all();

  it("serves an edge cache hit without a cookie", async () => {
    const cache = fakeCache();
    const { d1, env } = guardedEnv();
    fetchMock.mockResolvedValueOnce(jevOk("taco"));
    expect((await ask("taco", env, await cookie())).status).toBe(200);
    await Promise.all(pending);

    const response = await ask("taco", env);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Cube-Cache")).toBe("HIT");
    expect(cache.match).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usage(d1)).toEqual([{ day: expect.any(String), calls: 1 }]);
  });

  it("serves a KV hit without a cookie", async () => {
    const stored = JSON.stringify(mockCubeResponse("sushi"));
    const kv = fakeKv({ [`v${QUESTION_SET_VERSION}:sushi`]: stored });
    const { d1, env } = guardedEnv({ CLASSIFICATIONS: kv as unknown as KVNamespace });
    const response = await ask("sushi", env);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Cube-Cache")).toBe("KV");
    expect(d1.calls).toEqual([]);
  });

  it("answers a miss without a cookie with 401 challenge_required", async () => {
    const { d1, env } = guardedEnv();
    const response = await ask("taco", env);
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await errorBody(response)).error.code).toBe("challenge_required");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(d1.calls).toEqual(["SELECT calls FROM usage WHERE day = ?1"]);
    expect(usage(d1)).toEqual([]);
  });

  it("skips the human check with 503 daily_limit once the day is spent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T23:00:00Z"));
    const { d1, env } = guardedEnv({ DAILY_CALL_LIMIT: "2" });
    d1.sqlite.exec("INSERT INTO usage (day, calls) VALUES ('2026-09-22', 1)");
    expect((await ask("taco", env)).status).toBe(401);

    d1.sqlite.exec("UPDATE usage SET calls = 2");
    d1.calls.length = 0;
    const refused = await ask("taco", env);
    expect(refused.status).toBe(503);
    expect(refused.headers.get("Retry-After")).toBe("3600");
    expect(refused.headers.get("Cache-Control")).toBe("no-store");
    expect((await errorBody(refused)).error.code).toBe("daily_limit");
    expect(d1.calls).toEqual(["SELECT calls FROM usage WHERE day = ?1"]);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-09-23T00:00:01Z"));
    expect((await ask("taco", env)).status).toBe(401);
  });

  it("skips the human check without reading D1 when DAILY_CALL_LIMIT is 0", async () => {
    const { d1, env } = guardedEnv({ DAILY_CALL_LIMIT: "0" });
    const response = await ask("taco", env);
    expect(response.status).toBe(503);
    expect((await errorBody(response)).error.code).toBe("daily_limit");
    expect(d1.calls).toEqual([]);
  });

  it("still challenges when the early daily read fails, leaving the charge to refuse", async () => {
    const broken = {
      prepare: () => {
        throw new Error("D1_ERROR: rows read limit");
      },
    } as unknown as D1Database;
    const { env } = guardedEnv({ DB: broken });
    const response = await ask("taco", env);
    expect(response.status).toBe(401);
    expect((await errorBody(response)).error.code).toBe("challenge_required");
    expect(JSON.stringify(logs)).toContain("classify: daily usage read failed");
  });

  it("rejects an expired or tampered cookie", async () => {
    const { env } = guardedEnv();
    const stale = await cookie(Date.now() - 3601 * 1000);
    const valid = await cookie();
    // The signature's last base64url character carries padding bits, so tamper with the payload.
    const at = valid.indexOf("=") + 1;
    const tampered = `${valid.slice(0, at)}${valid[at] === "e" ? "f" : "e"}${valid.slice(at + 1)}`;
    for (const value of [stale, tampered, `${SESSION_COOKIE}=junk`]) {
      expect((await ask("taco", env, value)).status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls Jev with a valid cookie and counts the call", async () => {
    const { d1, env } = guardedEnv();
    fetchMock.mockResolvedValueOnce(jevOk("taco"));
    const response = await ask("taco", env, await cookie());
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Cube-Cache")).toBe("MISS");
    expect(usage(d1)).toEqual([{ day: new Date().toISOString().slice(0, 10), calls: 1 }]);
    expect(d1.sqlite.prepare("SELECT calls FROM sessions").all()).toEqual([{ calls: 1 }]);
  });

  it("refuses Jev past DAILY_CALL_LIMIT until UTC midnight, but keeps serving the cache", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T23:00:00Z"));
    const cache = fakeCache();
    const { d1, env } = guardedEnv({ DAILY_CALL_LIMIT: "2" });
    const session = await cookie();
    fetchMock.mockImplementation(async () => jevOk("taco"));

    expect((await ask("taco", env, session)).status).toBe(200);
    expect((await ask("pizza", env, session)).status).toBe(200);
    const refused = await ask("sushi", env, session);
    expect(refused.status).toBe(503);
    expect(refused.headers.get("Retry-After")).toBe("3600");
    expect(refused.headers.get("Cache-Control")).toBe("no-store");
    expect((await errorBody(refused)).error.code).toBe("daily_limit");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(usage(d1)).toEqual([{ day: "2026-09-22", calls: 2 }]);
    expect(d1.sqlite.prepare("SELECT calls FROM sessions").all()).toEqual([{ calls: 2 }]);

    await Promise.all(pending);
    expect(cache.store.size).toBe(2);
    expect((await ask("taco", env)).status).toBe(200);

    vi.setSystemTime(new Date("2026-09-23T00:00:01Z"));
    expect((await ask("sushi", env, await cookie())).status).toBe(200);
  });

  it("answers a prefetch miss with 204, even with a session, and never calls Jev", async () => {
    const cache = fakeCache();
    const { d1, env } = guardedEnv();
    const prefetch = { [PREFETCH_HEADER]: "1" };
    const miss = await ask("taco", env, await cookie(), prefetch);
    expect(miss.status).toBe(204);
    expect(miss.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(d1.calls).toEqual([]);

    cache.store.set(
      `${ORIGIN}${classifyUrl("taco")}`,
      new Response(JSON.stringify(mockCubeResponse("taco"))),
    );
    expect((await ask("taco", env, undefined, prefetch)).status).toBe(200);
  });

  it("caps new rulings per client per UTC day, without spending the session or the day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T20:00:00Z"));
    const { d1, env } = guardedEnv();
    fetchMock.mockImplementation(async () => jevOk("taco"));
    expect((await ask("taco", env, await cookie())).status).toBe(200);
    d1.sqlite.exec(`UPDATE clients SET calls = ${CLIENT_DAILY_CALL_LIMIT}`);

    const session = await cookie();
    const refused = await ask("pizza", env, session);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe(String(4 * 3600));
    expect((await errorBody(refused)).error.code).toBe("client_limit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usage(d1)).toEqual([{ day: "2026-09-22", calls: 1 }]);
    const sessions = d1.sqlite.prepare("SELECT calls FROM sessions ORDER BY calls").all();
    expect(sessions).toEqual([{ calls: 0 }, { calls: 1 }]);

    const elsewhere = { "CF-Connecting-IP": "198.51.100.4" };
    expect((await ask("pizza", env, session, elsewhere)).status).toBe(200);
    vi.setSystemTime(new Date("2026-09-23T00:00:01Z"));
    expect((await ask("sushi", env, await cookie())).status).toBe(200);
  });

  it("keys the client counter on a daily HMAC, never the raw IP", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T20:00:00Z"));
    const { d1, env } = guardedEnv();
    fetchMock.mockImplementation(async () => jevOk("taco"));
    await ask("taco", env, await cookie());
    vi.setSystemTime(new Date("2026-09-23T01:00:00Z"));
    await ask("pizza", env, await cookie());
    const rows = d1.sqlite.prepare("SELECT key, day, calls FROM clients ORDER BY day").all();
    expect(rows).toEqual([
      { key: expect.stringMatching(/^[\w-]{43}$/), day: "2026-09-22", calls: 1 },
      { key: expect.stringMatching(/^[\w-]{43}$/), day: "2026-09-23", calls: 1 },
    ]);
    expect(rows[0]?.key).not.toBe(rows[1]?.key);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.7");
  });

  it("refunds the client too when the day refuses", async () => {
    const { d1, env } = guardedEnv({ DAILY_CALL_LIMIT: "0" });
    await ask("taco", env, await cookie());
    expect(d1.sqlite.prepare("SELECT calls FROM clients").all()).toEqual([{ calls: 0 }]);
  });

  it("does not spend the session on refusals once the day is spent", async () => {
    const { d1, env } = guardedEnv({ DAILY_CALL_LIMIT: "0" });
    const session = await cookie();
    for (let i = 0; i <= SESSION_CALL_LIMIT; i++) {
      const response = await ask(`food ${i}`, env, session);
      expect((await errorBody(response)).error.code).toBe("daily_limit");
    }
    expect(d1.sqlite.prepare("SELECT calls FROM sessions").all()).toEqual([{ calls: 0 }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats DAILY_CALL_LIMIT=0 as a kill switch", async () => {
    const { env } = guardedEnv({ DAILY_CALL_LIMIT: "0" });
    const response = await ask("taco", env, await cookie());
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-challenges a session that used its calls without spending the daily budget", async () => {
    const { d1, env } = guardedEnv();
    const session = await cookie();
    fetchMock.mockImplementation(async () => jevOk("taco"));
    expect((await ask("taco", env, session)).status).toBe(200);
    d1.sqlite.exec(`UPDATE sessions SET calls = ${SESSION_CALL_LIMIT}`);

    const response = await ask("pizza", env, session);
    expect(response.status).toBe(401);
    expect((await errorBody(response)).error.code).toBe("challenge_required");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usage(d1)).toEqual([{ day: expect.any(String), calls: 1 }]);
    expect((await ask("pizza", env, await cookie())).status).toBe(200);
  });

  it("fails closed when TURNSTILE_SECRET_KEY is set without SESSION_SECRET", async () => {
    const cache = fakeCache();
    const { d1, env } = guardedEnv({ SESSION_SECRET: undefined });
    const response = await ask("taco", env, await cookie());
    expect(response.status).toBe(500);
    expect((await errorBody(response)).error.code).toBe("internal");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(d1.calls).toEqual([]);
    expect(JSON.stringify(logs)).toContain("SESSION_SECRET is missing");

    const stored = new Response(JSON.stringify(mockCubeResponse("taco")));
    cache.store.set(`${ORIGIN}${classifyUrl("taco")}`, stored);
    expect((await ask("taco", env)).status).toBe(200);
  });

  it("refuses Jev when the spend check itself fails", async () => {
    const broken = {
      prepare: () => {
        throw new Error("D1_ERROR: no such table: usage");
      },
    } as unknown as D1Database;
    const { env } = guardedEnv({ DB: broken });
    const response = await ask("taco", env, await cookie());
    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(logs)).not.toContain("no such table");
  });

  it("skips the caps with one warning when DB is not bound", async () => {
    fetchMock.mockImplementation(async () => jevOk("taco"));
    const { env } = guardedEnv({ DB: undefined, TURNSTILE_SECRET_KEY: undefined });
    expect((await ask("taco", env)).status).toBe(200);
    expect((await ask("pizza", env)).status).toBe(200);
    const warnings = logs.filter(([message]) => String(message).includes("no DB binding"));
    expect(warnings.length).toBeLessThanOrEqual(1);
  });

  it("challenges mock rulings too, so the flow can be tried without a key", async () => {
    const { d1, env } = guardedEnv({ TYPESAFE_API_KEY: undefined });
    expect((await ask("taco", env)).status).toBe(401);
    const response = await ask("taco", env, await cookie());
    expect(response.status).toBe(200);
    expect(((await response.json()) as ClassifyResponse).mock).toBe(true);
    expect(d1.calls).toEqual([]);
  });

  it("never logs the session secret or cookie", async () => {
    const { env } = guardedEnv();
    const value = await cookie();
    fetchMock.mockResolvedValueOnce(jevOk("taco"));
    await ask("taco", env, value);
    await ask("pizza", env, `${value}x`);
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain(SESSION_SECRET);
    expect(logged).not.toContain(value.split("=")[1]);
  });
});

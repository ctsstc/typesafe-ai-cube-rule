// @vitest-environment node
import {
  type ClassifyErrorBody,
  type ClassifyResponse,
  classifyUrl,
  isClassifyErrorBody,
  mockCubeResponse,
  QUESTION_SET_VERSION,
} from "@cube/core";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { onRequest as apiFallback } from "../api/[[path]]";
import { createClassifyHandler, type Env } from "./classify";
import { createRateLimiter } from "./rate-limit";

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

describe("request validation", () => {
  it("rejects anything but GET with 405", async () => {
    for (const method of ["POST", "HEAD", "PUT", "OPTIONS"]) {
      const response = await call(classifyUrl("taco"), undefined, { method });
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no query", "/api/classify"],
    ["missing version", "/api/classify?food=taco"],
    ["stale version", "/api/classify?food=taco&v=0"],
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

  it("accepts the canonical URL built by classifyUrl", async () => {
    fetchMock.mockResolvedValueOnce(jevOk("hot dog"));
    const response = await call(classifyUrl("hot dog"));
    expect(response.status).toBe(200);
  });

  it("answers unknown /api paths with a JSON 404 instead of the SPA", async () => {
    const response = await apiFallback({} as Parameters<typeof apiFallback>[0]);
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect((await errorBody(response)).error.code).toBe("bad_request");
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

  it("turns unexpected exceptions into a JSON 500", async () => {
    const handler = createClassifyHandler({
      take: () => {
        throw new Error("limiter bug");
      },
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

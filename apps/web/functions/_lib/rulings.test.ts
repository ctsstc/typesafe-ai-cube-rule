// @vitest-environment node
import {
  type ClassifyResponse,
  classifyUrl,
  MOCK_DECLINE_TRIGGER,
  MOCK_PRIVATE_PERSON_TRIGGER,
  mockCubeResponse,
  PREFETCH_HEADER,
  QUESTION_SET_VERSION,
} from "@cube/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClassifyHandler, type Env } from "./classify";
import { type FakeD1, fakeD1, tableScans } from "./fake-d1";
import { createRateLimiter } from "./rate-limit";
import { MIN_ASKS } from "./rulings";

const ORIGIN = "https://oracle.example";
const KEY = "ts-test-key-do-not-leak";
const NOW = Date.parse("2026-09-23T12:00:00Z");

let pending: Promise<unknown>[];
let logs: unknown[][];

beforeEach(() => {
  pending = [];
  logs = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  for (const level of ["error", "warn", "log", "info", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args));
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Mock answers made listable: the mock's abusive score sits above the public bar on purpose. */
function listable(item: string): ClassifyResponse {
  const { answers } = mockCubeResponse(item);
  return { model: "jev-1.13.0", answers: { ...answers, is_abusive: { type: "noul", noul: 0.01 } } };
}

function jevReturns(response: ClassifyResponse) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ ...response, usage: { input_tokens: 12 } }), {
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function fakeCache() {
  const store = new Map<string, Response>();
  vi.stubGlobal("caches", {
    default: {
      match: async (key: Request) => store.get(key.url)?.clone(),
      put: async (key: Request, response: Response) => void store.set(key.url, response),
    },
  });
  return store;
}

function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    binding: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => void store.set(key, value),
    } as unknown as KVNamespace,
  };
}

async function ask(item: string, env: Env, headers: Record<string, string> = {}) {
  const handler = createClassifyHandler(createRateLimiter({ limit: 100, windowMs: 60_000 }));
  const request = new Request(`${ORIGIN}${classifyUrl(item)}`, {
    headers: { "CF-Connecting-IP": "203.0.113.7", ...headers },
  });
  const response = await handler(request, env, (promise) => void pending.push(promise));
  await Promise.all(pending);
  return response;
}

const rows = (d1: FakeD1) =>
  d1.sqlite.prepare("SELECT * FROM rulings ORDER BY item").all() as Record<string, unknown>[];

describe("recording rulings", () => {
  it("stores a fresh Jev ruling as one ask, with its list fields", async () => {
    const d1 = fakeD1();
    jevReturns(listable("hot dog"));
    const response = await ask("hot dog", { TYPESAFE_API_KEY: KEY, DB: d1.binding });
    expect(response.headers.get("X-Cube-Cache")).toBe("MISS");
    expect(rows(d1)).toEqual([
      {
        question_set: QUESTION_SET_VERSION,
        item: "hot dog",
        kind: "food",
        category: expect.any(String),
        wet: 0,
        confidence: expect.any(Number),
        runner_up: expect.any(String),
        official: "taco",
        debate_level: expect.any(Number),
        person_none: expect.any(Number),
        person_public: expect.any(Number),
        person_private: expect.any(Number),
        abusive: 0.01,
        listed: 1,
        reason: "listed",
        asks: 1,
        first_seen: NOW / 1000,
      },
    ]);
  });

  it("counts cache and KV hits as asks, and stops writing at MIN_ASKS", async () => {
    const d1 = fakeD1();
    const kv = fakeKv();
    const cache = fakeCache();
    jevReturns(listable("pizza"));
    const env: Env = { TYPESAFE_API_KEY: KEY, DB: d1.binding, CLASSIFICATIONS: kv.binding };
    await ask("pizza", env);
    cache.clear();
    expect((await ask("pizza", env)).headers.get("X-Cube-Cache")).toBe("KV");
    expect((await ask("pizza", env)).headers.get("X-Cube-Cache")).toBe("HIT");
    expect(rows(d1)[0]?.asks).toBe(MIN_ASKS);
    const before = JSON.stringify(rows(d1));
    await ask("pizza", env);
    expect(JSON.stringify(rows(d1))).toBe(before);
    expect(d1.changes.at(-1)).toBe(0);
  });

  // The browser keeps the prefetched ruling for a year, so a prefetch hit still counts one browser.
  it("counts a prefetch hit as an ask, and never a prefetch miss", async () => {
    const d1 = fakeD1();
    const kv = fakeKv();
    fakeCache();
    jevReturns(listable("sushi"));
    const env: Env = { TYPESAFE_API_KEY: KEY, DB: d1.binding, CLASSIFICATIONS: kv.binding };
    await ask("sushi", env);
    const prefetch = await ask("sushi", env, { [PREFETCH_HEADER]: "1" });
    expect(prefetch.status).toBe(200);
    expect(rows(d1)[0]?.asks).toBe(MIN_ASKS);

    const miss = await ask("nobody asked", env, { [PREFETCH_HEADER]: "1" });
    expect(miss.status).toBe(204);
    expect(rows(d1).map((row) => row.item)).toEqual(["sushi"]);
  });

  it("records a ruling from its stored copy when the Jev call's record failed", async () => {
    const d1 = fakeD1();
    const kv = fakeKv();
    const cache = fakeCache();
    jevReturns(listable("hot dog"));
    const env: Env = { TYPESAFE_API_KEY: KEY, DB: d1.binding, CLASSIFICATIONS: kv.binding };
    d1.failNext(/^INSERT INTO rulings/);
    await ask("hot dog", env);
    expect(rows(d1)).toEqual([]);
    expect(JSON.stringify(logs)).toContain("classify: ruling record failed");

    expect((await ask("hot dog", env)).headers.get("X-Cube-Cache")).toBe("HIT");
    expect(rows(d1)[0]).toMatchObject({ item: "hot dog", official: "taco", listed: 1, asks: 1 });
    cache.clear();
    expect((await ask("hot dog", env)).headers.get("X-Cube-Cache")).toBe("KV");
    expect(rows(d1)[0]?.asks).toBe(MIN_ASKS);
  });

  it("records the reason a ruling is hidden, and leaves the blocklist to read time", async () => {
    const d1 = fakeD1();
    const env: Env = { TYPESAFE_API_KEY: KEY, DB: d1.binding };
    d1.sqlite.exec("INSERT INTO blocklist (item, added_at) VALUES ('nacho platter', 0)");
    for (const item of ["nacho platter", MOCK_PRIVATE_PERSON_TRIGGER, "call 555 123 4567"]) {
      jevReturns(listable(item));
      await ask(item, env);
    }
    jevReturns(mockCubeResponse(`a ${MOCK_DECLINE_TRIGGER}`));
    await ask(`a ${MOCK_DECLINE_TRIGGER}`, env);
    const hidden = rows(d1).map(({ item, kind, category, listed, reason }) => ({
      item,
      kind,
      category,
      listed,
      reason,
    }));
    expect(hidden).toEqual([
      {
        item: `a ${MOCK_DECLINE_TRIGGER}`,
        kind: "declined",
        category: null,
        listed: 0,
        reason: "declined",
      },
      {
        item: "call 555 123 4567",
        kind: "food",
        category: expect.any(String),
        listed: 0,
        reason: "personal_info",
      },
      {
        item: MOCK_PRIVATE_PERSON_TRIGGER,
        kind: "honorary",
        category: expect.any(String),
        listed: 0,
        reason: "private_person",
      },
      {
        item: "nacho platter",
        kind: "food",
        category: expect.any(String),
        listed: 1,
        reason: "listed",
      },
    ]);
  });

  it("counts a second Jev call for the same item as another ask", async () => {
    const d1 = fakeD1();
    jevReturns(listable("taco"));
    const env: Env = { TYPESAFE_API_KEY: KEY, DB: d1.binding };
    await ask("taco", env);
    vi.setSystemTime(NOW + 60_000);
    await ask("taco", env);
    await ask("taco", env);
    expect(rows(d1)[0]).toMatchObject({ asks: MIN_ASKS, first_seen: NOW / 1000 });

    const moved = listable("taco");
    jevReturns({
      ...moved,
      answers: { ...moved.answers, is_abusive: { type: "noul", noul: 0.02 } },
    });
    await ask("taco", env);
    expect(rows(d1)[0]?.abusive).toBe(0.01);
    expect(d1.changes.at(-1)).toBe(0);
  });

  it("writes nothing in mock mode", async () => {
    const d1 = fakeD1();
    const response = await ask("taco", { DB: d1.binding });
    expect(((await response.json()) as ClassifyResponse).mock).toBe(true);
    expect(d1.calls).toEqual([]);
  });

  it("still serves the ruling when recording fails, and logs no item", async () => {
    const d1 = fakeD1();
    d1.sqlite.exec("DROP TABLE rulings");
    const kv = fakeKv();
    fakeCache();
    jevReturns(listable("secret lasagna"));
    const env: Env = { TYPESAFE_API_KEY: KEY, DB: d1.binding, CLASSIFICATIONS: kv.binding };
    expect((await ask("secret lasagna", env)).status).toBe(200);
    expect((await ask("secret lasagna", env)).status).toBe(200);
    const logged = JSON.stringify(logs);
    expect(logged).toContain("classify: ruling record failed");
    expect(logged).toContain("classify: ask count failed");
    expect(logged).not.toContain("secret lasagna");
  });

  it("skips recording silently without a DB binding", async () => {
    jevReturns(listable("taco"));
    expect((await ask("taco", { TYPESAFE_API_KEY: KEY })).status).toBe(200);
    expect(JSON.stringify(logs)).not.toMatch(/ruling record|ask count/);
  });
});

describe("D1 statements", () => {
  it("records through the primary keys, never a table scan", async () => {
    const d1 = fakeD1();
    const kv = fakeKv();
    jevReturns(listable("taco"));
    const env: Env = { TYPESAFE_API_KEY: KEY, DB: d1.binding, CLASSIFICATIONS: kv.binding };
    await ask("taco", env);
    await ask("taco", env);
    const recording = d1.calls.filter((sql) => /\b(rulings|blocklist)\b/.test(sql));
    expect(new Set(recording).size).toBe(2);
    expect(tableScans(d1)).toEqual([]);
  });
});

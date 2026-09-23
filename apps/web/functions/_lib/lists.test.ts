// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type ClassifyErrorBody,
  isListsResponse,
  LIST_NAMES,
  LISTS_PATH,
  type ListsResponse,
  listsUrl,
  QUESTION_SET_VERSION,
  THRESHOLDS,
} from "@cube/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { type FakeD1, fakeD1, tableScans } from "./fake-d1";
import {
  ACTIVITY_CAP,
  activityThreshold,
  DEFAULT_ACTIVITY_THRESHOLD,
  handleLists,
  LIST_LENGTH,
  LISTS_TTL_S,
  listsEnabled,
} from "./lists";
import { MIN_ASKS } from "./rulings";

const ORIGIN = "https://oracle.example";
const NOW = Date.parse("2026-09-23T12:00:00Z");
const NOW_S = NOW / 1000;
const CACHED = `public, max-age=${LISTS_TTL_S}`;

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

interface Seed {
  item: string;
  kind?: string;
  category?: string;
  wet?: number;
  confidence?: number;
  runner_up?: string | null;
  official?: string | null;
  debate_level?: number;
  listed?: number;
  reason?: string;
  asks?: number;
  first_seen?: number;
  question_set?: string;
}

function seed(d1: FakeD1, ...rows: Seed[]) {
  const insert = d1.sqlite.prepare(
    `INSERT INTO rulings (question_set, item, kind, category, wet, confidence, runner_up, official,
      debate_level, listed, reason, asks, first_seen)
    VALUES (:question_set, :item, :kind, :category, :wet, :confidence, :runner_up, :official,
      :debate_level, :listed, :reason, :asks, :first_seen)`,
  );
  for (const row of rows) {
    insert.run({
      question_set: QUESTION_SET_VERSION,
      kind: "food",
      category: "sandwich",
      wet: 0,
      confidence: 0.6,
      runner_up: null,
      official: null,
      debate_level: 1,
      listed: 1,
      reason: "listed",
      asks: MIN_ASKS,
      first_seen: NOW_S - 7200,
      ...row,
    });
  }
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

async function get(env: Env, path = listsUrl(), method = "GET") {
  const response = await handleLists(
    new Request(`${ORIGIN}${path}`, { method }),
    env,
    (promise) => void pending.push(promise),
  );
  await Promise.all(pending);
  return response;
}

async function body(response: Response): Promise<ListsResponse> {
  const json: unknown = await response.json();
  if (!isListsResponse(json)) throw new Error(`not a lists response: ${JSON.stringify(json)}`);
  return json;
}

const items = (response: ListsResponse) =>
  Object.fromEntries(LIST_NAMES.map((name) => [name, response.lists[name].map((e) => e.item)]));

describe("GET /api/lists", () => {
  it("rejects anything but GET with 405", async () => {
    const d1 = fakeD1();
    for (const method of ["POST", "HEAD", "PUT"]) {
      const response = await get({ DB: d1.binding }, listsUrl(), method);
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET");
    }
    expect(d1.calls).toEqual([]);
  });

  it("tells a tab from another question set to reload", async () => {
    const response = await get({}, `${LISTS_PATH}?v=${Number(QUESTION_SET_VERSION) - 1}`);
    expect(response.status).toBe(409);
    expect(((await response.json()) as ClassifyErrorBody).error.code).toBe("stale_client");
  });

  it.each([
    LISTS_PATH,
    `${listsUrl()}&x=1`,
    `${LISTS_PATH}?v=${QUESTION_SET_VERSION}&v=${QUESTION_SET_VERSION}`,
    `${LISTS_PATH}?version=${QUESTION_SET_VERSION}`,
  ])("answers the non-canonical %s with 400", async (path) => {
    const response = await get({}, path);
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("serves the four lists from public rows only", async () => {
    const d1 = fakeD1();
    const ago = (seconds: number) => NOW_S - seconds;
    seed(
      d1,
      { item: "new", first_seen: ago(100), confidence: 0.4 },
      { item: "blaze", first_seen: ago(200), confidence: 0.5, debate_level: 3, runner_up: "taco" },
      { item: "hot dog", first_seen: ago(300), confidence: 0.9, debate_level: 2, official: "taco" },
      { item: "sandwich", first_seen: ago(400), confidence: 0.65, official: "sandwich" },
      {
        item: "a cat",
        first_seen: ago(500),
        kind: "honorary",
        category: "calzone",
        debate_level: 0,
      },
      {
        item: "unanimous",
        first_seen: ago(600),
        confidence: THRESHOLDS.unanimous,
        debate_level: 0,
      },
      { item: "old", first_seen: ago(9000), confidence: 0.7 },
      { item: "once", first_seen: ago(50), asks: 1 },
      { item: "my boss", first_seen: ago(40), listed: 0, reason: "private_person" },
      { item: "blocked", first_seen: ago(30), confidence: 0.1 },
      { item: "old set", first_seen: ago(20), confidence: 0.1, question_set: "1" },
    );
    d1.sqlite.exec("INSERT INTO blocklist (item, added_at) VALUES ('blocked', 0)");

    const response = await get({ DB: d1.binding });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(CACHED);
    const lists = await body(response);
    expect(lists.enabled).toBe(true);
    expect(lists.questionSetVersion).toBe(QUESTION_SET_VERSION);
    expect(items(lists)).toEqual({
      latest: ["new", "blaze", "hot dog", "sandwich", "a cat", "unanimous", "old"],
      mostDebated: ["new", "blaze", "a cat", "sandwich", "old"],
      jevDissents: ["hot dog"],
      friendshipEnding: ["blaze", "hot dog", "new", "sandwich", "old"],
    });
    expect(lists.lists.friendshipEnding[0]).toEqual({
      item: "blaze",
      kind: "food",
      category: "sandwich",
      wet: false,
      confidence: 0.5,
      runnerUp: "taco",
      official: null,
      debateLevel: 3,
    });
    expect(JSON.stringify(lists)).not.toMatch(/first_seen|asks|listed|reason/);
  });

  it(`returns at most ${LIST_LENGTH} entries per list`, async () => {
    const d1 = fakeD1();
    seed(d1, ...Array.from({ length: LIST_LENGTH + 3 }, (_, i) => ({ item: `food ${i}` })));
    const lists = await body(await get({ DB: d1.binding }));
    for (const name of LIST_NAMES) {
      expect(lists.lists[name].length).toBeLessThanOrEqual(LIST_LENGTH);
    }
    expect(lists.lists.latest).toHaveLength(LIST_LENGTH);
  });

  it("drops personal info at read time too", async () => {
    const d1 = fakeD1();
    seed(d1, { item: "555 123 4567 pizza" }, { item: "pizza" });
    expect(items(await body(await get({ DB: d1.binding }))).latest).toEqual(["pizza"]);
  });

  it("shows activity only at or above ACTIVITY_THRESHOLD", async () => {
    const d1 = fakeD1();
    const recent = (n: number, from = 0) =>
      Array.from({ length: n }, (_, i) => ({
        item: `new ${from + i}`,
        asks: 1,
        listed: 0,
        first_seen: NOW_S - 60,
      }));
    seed(d1, ...recent(DEFAULT_ACTIVITY_THRESHOLD - 1), {
      item: "stale",
      first_seen: NOW_S - 3601,
    });
    expect((await body(await get({ DB: d1.binding }))).activity).toBeNull();

    seed(d1, ...recent(1, 100));
    const lists = await body(await get({ DB: d1.binding }));
    expect(lists.activity).toEqual({ newFoodsLastHour: DEFAULT_ACTIVITY_THRESHOLD });
    expect((await body(await get({ DB: d1.binding, ACTIVITY_THRESHOLD: "50" }))).activity).toBe(
      null,
    );
  });

  it(`caps the activity count at ${ACTIVITY_CAP}`, async () => {
    const d1 = fakeD1();
    seed(
      d1,
      ...Array.from({ length: ACTIVITY_CAP + 5 }, (_, i) => ({
        item: `new ${i}`,
        first_seen: NOW_S - i,
      })),
    );
    const lists = await body(await get({ DB: d1.binding }));
    expect(lists.activity).toEqual({ newFoodsLastHour: ACTIVITY_CAP });
  });

  it("serves the edge copy without touching D1 until it expires", async () => {
    const d1 = fakeD1();
    const cache = fakeCache();
    seed(d1, { item: "pizza" });
    const first = await get({ DB: d1.binding });
    expect(first.headers.get("X-Cube-Cache")).toBe("MISS");
    const reads = d1.calls.length;

    const second = await get({ DB: d1.binding });
    expect(second.headers.get("X-Cube-Cache")).toBe("HIT");
    expect(second.headers.get("Cache-Control")).toBe(CACHED);
    expect(await second.text()).toBe(await first.text());
    expect(d1.calls).toHaveLength(reads);
    expect(cache.put.mock.calls[0]?.[0].url).toBe(`${ORIGIN}${listsUrl()}`);
  });

  it("hides everything behind the kill switch, even an edge copy", async () => {
    const d1 = fakeD1();
    const cache = fakeCache();
    seed(d1, { item: "pizza" });
    await get({ DB: d1.binding });
    d1.calls.length = 0;

    for (const value of ["off", "OFF", "false", "0", "of"]) {
      const response = await get({ DB: d1.binding, PUBLIC_LISTS: value });
      expect(await body(response)).toEqual({
        enabled: false,
        questionSetVersion: QUESTION_SET_VERSION,
        activity: null,
        lists: { latest: [], mostDebated: [], jevDissents: [], friendshipEnding: [] },
      });
    }
    expect(d1.calls).toEqual([]);
    expect(cache.match).toHaveBeenCalledTimes(1);
  });

  it("ships with the lists on and the default activity threshold", () => {
    const text = readFileSync(
      fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url).href),
      "utf8",
    );
    const { vars } = JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as {
      vars: Record<string, string>;
    };
    expect(vars.PUBLIC_LISTS).toBe("on");
    expect(vars.ACTIVITY_THRESHOLD).toBe(String(DEFAULT_ACTIVITY_THRESHOLD));
  });

  it.each([
    [undefined, true],
    ["", true],
    ["on", true],
    [" On ", true],
    ["off", false],
    ["yes", false],
  ])("reads PUBLIC_LISTS=%j as enabled=%s", (value, enabled) => {
    expect(listsEnabled({ PUBLIC_LISTS: value })).toBe(enabled);
  });

  it.each([
    [undefined, DEFAULT_ACTIVITY_THRESHOLD],
    ["abc", DEFAULT_ACTIVITY_THRESHOLD],
    ["0", DEFAULT_ACTIVITY_THRESHOLD],
    [" 12 ", 12],
  ])("reads ACTIVITY_THRESHOLD=%j as %i", (value, threshold) => {
    expect(activityThreshold({ ACTIVITY_THRESHOLD: value })).toBe(threshold);
  });

  it("answers enabled false with no-store when D1 fails, never a 500", async () => {
    const cache = fakeCache();
    const broken = {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => {
        throw new Error("D1_ERROR: rows read limit");
      },
    } as unknown as D1Database;
    const response = await get({ DB: broken });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await body(response)).enabled).toBe(false);
    expect(cache.put).not.toHaveBeenCalled();
    expect(JSON.stringify(logs)).toContain("lists: read failed");
  });

  it("answers enabled false with no-store before migration 0006", async () => {
    const d1 = fakeD1();
    d1.sqlite.exec("DROP TABLE rulings");
    const response = await get({ DB: d1.binding });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await body(response)).enabled).toBe(false);
  });

  it("answers enabled false without a DB binding", async () => {
    const response = await get({});
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await body(response)).enabled).toBe(false);
  });

  it("needs no cookie or challenge", async () => {
    const d1 = fakeD1();
    seed(d1, { item: "pizza" });
    const env: Env = {
      DB: d1.binding,
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    };
    expect(items(await body(await get(env))).latest).toEqual(["pizza"]);
  });
});

describe("D1 statements", () => {
  it("reads the lists through indexes, never a table scan", async () => {
    const d1 = fakeD1();
    seed(d1, { item: "pizza" }, { item: "hot dog", official: "taco" });
    await get({ DB: d1.binding });
    expect(new Set(d1.calls).size).toBe(LIST_NAMES.length + 1);
    expect(tableScans(d1)).toEqual([]);
  });
});

// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type ClassifyErrorBody,
  disabledListsResponse,
  isListsResponse,
  LIST_NAMES,
  LISTS_PATH,
  type ListEntry,
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
  onePerCube,
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
  person_none?: number | null;
  person_public?: number | null;
  person_private?: number | null;
  abusive?: number | null;
}

function seed(d1: FakeD1, ...rows: Seed[]) {
  const insert = d1.sqlite.prepare(
    `INSERT INTO rulings (question_set, item, kind, category, wet, confidence, runner_up, official,
      debate_level, person_none, person_public, person_private, abusive, listed, reason, asks,
      first_seen)
    VALUES (:question_set, :item, :kind, :category, :wet, :confidence, :runner_up, :official,
      :debate_level, :person_none, :person_public, :person_private, :abusive, :listed, :reason,
      :asks, :first_seen)`,
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
      person_none: 0.99,
      person_public: 0,
      person_private: 0.01,
      abusive: 0.01,
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
    const honorary = { kind: "honorary", debate_level: 0 };
    seed(
      d1,
      { item: "new", first_seen: ago(100), confidence: 0.4, asks: 1 },
      { item: "blaze", first_seen: ago(200), confidence: 0.5, debate_level: 3, runner_up: "taco" },
      { item: "hot dog", first_seen: ago(300), confidence: 0.9, debate_level: 2, official: "taco" },
      { item: "sandwich", first_seen: ago(400), confidence: 0.65, official: "sandwich" },
      { item: "a cat", first_seen: ago(500), category: "calzone", ...honorary },
      { item: "a canoe", first_seen: ago(550), category: "taco", confidence: 0.97, ...honorary },
      {
        item: "unanimous",
        first_seen: ago(600),
        confidence: THRESHOLDS.unanimous,
        debate_level: 0,
      },
      { item: "old", first_seen: ago(9000), confidence: 0.7 },
      {
        item: "my boss",
        first_seen: ago(40),
        confidence: 0.99,
        listed: 0,
        reason: "private_person",
        ...honorary,
      },
      { item: "blocked", first_seen: ago(30), confidence: 0.1 },
      { item: "blocked canoe", first_seen: ago(35), confidence: 0.99, ...honorary },
      { item: "old set", first_seen: ago(20), confidence: 0.99, question_set: "1", ...honorary },
    );
    d1.sqlite.exec(
      "INSERT INTO blocklist (item, added_at) VALUES ('blocked', 0), ('blocked canoe', 0)",
    );

    const response = await get({ DB: d1.binding });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(CACHED);
    const lists = await body(response);
    expect(lists.enabled).toBe(true);
    expect(lists.questionSetVersion).toBe(QUESTION_SET_VERSION);
    expect(items(lists)).toEqual({
      latest: ["new", "blaze", "hot dog", "sandwich", "a cat", "a canoe", "unanimous", "old"],
      mostDebated: ["new", "blaze", "a cat", "sandwich", "old"],
      honoraryCourt: ["a canoe", "a cat"],
      friendshipEnding: ["blaze", "hot dog", "new", "sandwich", "old"],
    });
    expect(lists.lists.honoraryCourt[0]).toEqual({
      item: "a canoe",
      kind: "honorary",
      category: "taco",
      wet: false,
      confidence: 0.97,
      runnerUp: null,
      official: null,
      debateLevel: 0,
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

  it("rechecks the current bars on every stored row, so a stricter bar hides older rulings", async () => {
    const d1 = fakeD1();
    seed(
      d1,
      { item: "pizza" },
      {
        item: "tyler okonkwo's jollof rice",
        person_none: 0.03,
        person_public: 0.86,
        person_private: 0.11,
      },
      { item: "sven lindqvist", person_none: 0.02, person_public: 0.68, person_private: 0.04 },
      {
        item: "gordon ramsay",
        kind: "honorary",
        person_none: 0,
        person_public: 1,
        person_private: 0,
      },
      { item: "slutty brownies", abusive: 0.11 },
      { item: "humans", kind: "honorary", abusive: 0.12 },
      {
        item: "no scores",
        person_none: null,
        person_public: null,
        person_private: null,
        abusive: null,
      },
    );
    expect(items(await body(await get({ DB: d1.binding }))).latest?.sort()).toEqual([
      "gordon ramsay",
      "humans",
      "pizza",
    ]);
  });

  it("counts only listable rulings as activity", async () => {
    const d1 = fakeD1();
    const fresh = (n: number, more: Seed = {} as Seed) =>
      Array.from({ length: n }, (_, i) => ({
        asks: 1,
        first_seen: NOW_S - 60,
        ...more,
        item: `${more.item ?? "new"} ${i}`,
      }));
    seed(
      d1,
      ...fresh(DEFAULT_ACTIVITY_THRESHOLD - 1),
      ...fresh(10, { item: "declined", kind: "declined", listed: 0, reason: "declined" }),
    );
    expect((await body(await get({ DB: d1.binding }))).activity).toBeNull();
    seed(d1, ...fresh(1, { item: "one more" }));
    expect((await body(await get({ DB: d1.binding }))).activity).toEqual({
      newFoodsLastHour: DEFAULT_ACTIVITY_THRESHOLD,
    });
  });

  it("shows activity only at or above ACTIVITY_THRESHOLD", async () => {
    const d1 = fakeD1();
    const recent = (n: number, from = 0) =>
      Array.from({ length: n }, (_, i) => ({
        item: `new ${from + i}`,
        asks: 1,
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
    const high = await body(await get({ DB: d1.binding, ACTIVITY_THRESHOLD: "500" }));
    expect(high.activity).toEqual({ newFoodsLastHour: ACTIVITY_CAP });
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
        lists: { latest: [], mostDebated: [], honoraryCourt: [], friendshipEnding: [] },
      });
    }
    expect(d1.calls).toEqual([]);
    expect(cache.match).toHaveBeenCalledTimes(1);
  });

  it("turns off from D1 without a deploy", async () => {
    const d1 = fakeD1();
    seed(d1, { item: "pizza" }, { item: "tacos" }, { item: "sushi" });
    const flip = (value: string) =>
      d1.sqlite
        .prepare(
          "INSERT INTO switches (name, value, changed_at) VALUES ('lists', ?, 0) ON CONFLICT (name) DO UPDATE SET value = excluded.value",
        )
        .run(value);
    flip("off");
    const off = await get({ DB: d1.binding });
    expect(off.headers.get("Cache-Control")).toBe(CACHED);
    expect(await body(off)).toEqual(disabledListsResponse());
    flip("on");
    expect(items(await body(await get({ DB: d1.binding }))).latest).toHaveLength(3);
  });

  // Flipping the kill switch in wrangler.jsonc must not turn pnpm check red, or the deploy fails.
  it("ships a readable kill switch and activity threshold", () => {
    const text = readFileSync(
      fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url).href),
      "utf8",
    );
    const { vars } = JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as {
      vars: Record<string, string>;
    };
    expect(["on", "off"]).toContain(vars.PUBLIC_LISTS);
    expect(activityThreshold(vars)).toBe(Number(vars.ACTIVITY_THRESHOLD));
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
    ["500", ACTIVITY_CAP],
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
    expect(new Set(d1.calls).size).toBe(LIST_NAMES.length + 2);
    expect(tableScans(d1)).toEqual([]);
  });

  // The v1.2 Function's list reads, which a Pages rollback runs against the migrated schema.
  it.each([
    ["rulings_latest", "", "first_seen DESC"],
    ["rulings_debated", ` AND confidence < ${THRESHOLDS.unanimous}`, "confidence ASC"],
    ["rulings_dissents", " AND official <> category", "confidence DESC"],
    ["rulings_heat", " AND debate_level > 0", "debate_level DESC, first_seen DESC"],
  ])("still answers v1.2's read through %s after every migration", (index, where, order) => {
    const d1 = fakeD1();
    seed(d1, { item: "hot dog", official: "taco", asks: 2 }, { item: "pizza", asks: 1 });
    const rows = d1.sqlite
      .prepare(
        `SELECT item FROM rulings INDEXED BY ${index}
WHERE question_set = ?1 AND listed = 1 AND asks >= 2${where}
ORDER BY ${order} LIMIT ${LIST_LENGTH}`,
      )
      .all(QUESTION_SET_VERSION);
    expect(rows.map((row) => row.item)).toEqual(["hot dog"]);
  });
});

describe("onePerCube", () => {
  const honorary = (
    item: string,
    category: ListEntry["category"],
    official: ListEntry["official"] = null,
  ) => ({
    item,
    kind: "honorary" as const,
    category,
    wet: false,
    confidence: 1,
    runnerUp: null,
    official,
    debateLevel: 0 as const,
  });

  it("keeps the first ruling for each cube, so abstract salads cannot fill the court", () => {
    const court = onePerCube([
      honorary("existential dread", "salad"),
      honorary("good vibes", "salad"),
      honorary("humans", "toast", "calzone"),
      honorary("a canoe", "quiche"),
      honorary("the moon", "salad"),
      honorary("a sleeping bag", "calzone"),
    ]);
    expect(court.map((entry) => entry.item)).toEqual(["existential dread", "humans", "a canoe"]);
  });

  it("stops at the list length", () => {
    const cubes = [
      "salad",
      "toast",
      "sandwich",
      "taco",
      "sushi",
      "quiche",
      "calzone",
      "cake",
      "nachos",
    ] as const;
    expect(onePerCube(cubes.map((cube) => honorary(cube, cube)))).toHaveLength(LIST_LENGTH);
  });
});

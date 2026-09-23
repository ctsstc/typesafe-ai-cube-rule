import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIN_ASKS, recordRuling } from "../apps/web/functions/_lib/rulings.ts";
import { parseRaw, requestFingerprint } from "../eval/src/cache.ts";
import { loadDataset } from "../eval/src/dataset.ts";
import {
  CUBE_MODEL,
  mockCubeResponse,
  publicListing,
  QUESTION_SET_VERSION,
} from "../packages/core/src/index.ts";
import {
  askJev,
  DEFAULT_MAX_USD,
  formatPlan,
  inlineSql,
  KV_WRITE_CEILING,
  kvItems,
  kvPairs,
  lookupStatements,
  parseOptions,
  plan,
  rowsPerRuling,
  rowsWritten,
  rulingStatements,
  seedEntries,
  startOfUtcDay,
  UsageError,
  usageStatement,
  usageStatements,
} from "./seed-docket.mjs";

const NOW = Date.parse("2026-09-23T20:00:00Z");
const FINGERPRINT = "f".repeat(64);
const SET = "7";

// node:sqlite prints an ExperimentalWarning on first load, which would clutter pnpm check.
const { fakeD1 } = await (async () => {
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  try {
    await import("node:sqlite");
    return await import("../apps/web/functions/_lib/fake-d1.ts");
  } finally {
    process.emitWarning = emit;
  }
})();

/** Mock answers made listable: the mock's abusive score sits above the public bar on purpose. */
function listable(item) {
  const { answers } = mockCubeResponse(item);
  return { model: CUBE_MODEL, answers: { ...answers, is_abusive: { type: "noul", noul: 0.01 } } };
}

const record = (key, item = key, overrides = {}) => ({
  item: key,
  version: SET,
  fingerprint: FINGERPRINT,
  ...listable(item),
  usage: { input_tokens: 10_000, output_tokens: 500 },
  latencyMs: 100,
  attempts: 1,
  requestId: null,
  fetchedAt: "2026-09-23T16:12:00.008Z",
  ...overrides,
});

const seed = (records, dataset) =>
  seedEntries(records, dataset, { questionSet: SET, model: CUBE_MODEL, fingerprint: FINGERPRINT });

const entry = (item, firstSeen = Date.parse("2026-09-23T16:12:00Z")) => ({
  item,
  response: listable(item),
  firstSeen,
});

const emptyKv = () => ({ current: new Set(), earlier: new Set(), notCanonical: 0 });

const basePlan = (overrides = {}) =>
  plan({
    entries: [entry("gyro"), entry("hot dog")],
    kv: emptyKv(),
    recorded: new Set(),
    usageCalls: 0,
    backfill: false,
    now: NOW,
    rowsPerRuling: 7,
    ...overrides,
  });

describe("parseOptions", () => {
  it("is a dry run against production by default", () => {
    expect(parseOptions([])).toEqual({
      help: false,
      apply: false,
      backfill: false,
      maxUsd: DEFAULT_MAX_USD,
      local: false,
      persistTo: null,
    });
  });

  it("reads --apply, --backfill, --max-usd, --local and --persist-to", () => {
    expect(
      parseOptions([
        "--apply",
        "--backfill",
        "--max-usd",
        "0.01",
        "--local",
        "--persist-to",
        "/tmp/x",
      ]),
    ).toEqual({
      help: false,
      apply: true,
      backfill: true,
      maxUsd: 0.01,
      local: true,
      persistTo: "/tmp/x",
    });
    expect(parseOptions(["-h"])).toEqual({ help: true });
  });

  it.each([
    [["--max-usd", "1"], /only applies to --backfill/],
    [["--backfill", "--max-usd", "lots"], /dollar amount/],
    [["--backfill", "--max-usd=-1"], /dollar amount/],
    [["--persist-to", "x"], /needs --local/],
    [["--local", "--persist-to", " "], /needs a directory/],
    [["--yes"], /Unknown option/],
    [["pizza"], /Unexpected argument/],
  ])("refuses %j", (argv, message) => {
    expect(() => parseOptions(argv)).toThrow(UsageError);
    expect(() => parseOptions(argv)).toThrow(message);
  });
});

describe("seedEntries", () => {
  it("keeps only listed rulings of the current model and request, once each", () => {
    const encoded = Buffer.from("rude text").toString("base64");
    const dataset = [
      { key: "gyro", item: "gyro" },
      { key: "hot dog", item: "hot dog" },
      { key: "my boss", item: "my boss" },
      { key: encoded, item: "rude text", encoded: true },
      { key: "old", item: "old" },
      { key: "stale", item: "stale" },
      { key: "Loud Pizza", item: "Loud Pizza" },
      { key: "broken", item: "broken" },
      { key: "undated", item: "undated" },
      { key: "gyro again", item: "gyro" },
    ];
    const { answers } = listable("broken");
    const { entries, skipped } = seed(
      [
        record("gyro"),
        record("hot dog", "hot dog", { fetchedAt: "2026-09-23T16:59:59.999Z" }),
        record("my boss"),
        record(encoded, "rude text"),
        record("old", "old", { model: "jev-0.1" }),
        record("stale", "stale", { fingerprint: "0".repeat(64) }),
        record("Loud Pizza"),
        record("broken", "broken", { answers: { ...answers, category: undefined } }),
        record("undated", "undated", { fetchedAt: "yesterday" }),
        record("gyro again", "gyro"),
        record("gone"),
      ],
      dataset,
    );
    expect(entries.map((e) => [e.item, e.firstSeen])).toEqual([
      ["gyro", Date.parse("2026-09-23T16:12:00.008Z")],
      ["hot dog", Date.parse("2026-09-23T16:59:59.999Z")],
    ]);
    expect(Object.fromEntries(skipped)).toEqual({
      private_person: 1,
      "abusive probe": 1,
      "other model": 1,
      "stale request": 1,
      "not canonical": 1,
      malformed: 1,
      "no fetch time": 1,
      duplicate: 1,
      "not in the dataset": 1,
    });
  });

  it("never seeds an encoded abusive probe, even one the gates would pass", () => {
    const encoded = Buffer.from("gyro").toString("base64");
    const { entries, skipped } = seed(
      [record(encoded, "gyro")],
      [{ key: encoded, item: "gyro", encoded: true }],
    );
    expect(entries).toEqual([]);
    expect(Object.fromEntries(skipped)).toEqual({ "abusive probe": 1 });
  });

  it("skips person probes that are not foods but keeps foods named after people", () => {
    const { entries, skipped } = seed(
      [record("taylor swift"), record("my family"), record("eggs benedict")],
      [
        { key: "taylor swift", item: "taylor swift", expected: "not_food", person: "public" },
        { key: "my family", item: "my family", expected: "not_food", person: "none" },
        { key: "eggs benedict", item: "eggs benedict", expected: "toast", person: "none" },
      ],
    );
    expect(entries.map((e) => e.item)).toEqual(["eggs benedict"]);
    expect(Object.fromEntries(skipped)).toEqual({ "person probe": 2 });
  });

  it("seeds only listed, plain items from the real question set eval", () => {
    const text = readFileSync(
      new URL(`../eval/results/v${QUESTION_SET_VERSION}/raw.jsonl`, import.meta.url),
      "utf8",
    );
    const records = [...parseRaw(text).values()];
    const dataset = loadDataset();
    const { entries, skipped } = seedEntries(records, dataset, {
      questionSet: QUESTION_SET_VERSION,
      model: CUBE_MODEL,
      fingerprint: requestFingerprint(),
    });
    const encoded = new Set(dataset.filter((d) => d.encoded).map((d) => d.item));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length + [...skipped.values()].reduce((a, b) => a + b, 0)).toBe(records.length);
    for (const { item, response } of entries) {
      expect(encoded.has(item)).toBe(false);
      expect(publicListing(item, response)).toEqual({ listed: true, reason: "listed" });
    }
  });
});

describe("kvItems", () => {
  it("splits current and earlier question sets and drops non-canonical keys", () => {
    const kv = kvItems(
      ["v7:gyro", "v6:gyro", "v5:gyro", "v6:hot dog", "v6:Hot Dog", "v8:future", "other", "v6:"],
      "7",
    );
    expect([...kv.current]).toEqual(["gyro"]);
    expect([...kv.earlier]).toEqual(["gyro", "hot dog"]);
    expect(kv.notCanonical).toBe(2);
  });

  it("keeps a colon inside the item", () => {
    expect([...kvItems(["v6:tea: earl grey"], "7").earlier]).toEqual(["tea: earl grey"]);
  });
});

describe("plan", () => {
  it("seeds D1 rows not yet recorded and KV values not yet stored", () => {
    const result = basePlan({
      kv: { ...emptyKv(), current: new Set(["gyro"]) },
      recorded: new Set(["hot dog"]),
    });
    expect(result.seedRows.map((e) => e.item)).toEqual(["gyro"]);
    expect(result.seedKv.map((e) => e.item)).toEqual(["hot dog"]);
    expect(result.kvWrites).toBe(1);
    expect(result.d1Rows).toBe(7);
    expect(result.refusals).toEqual([]);
  });

  it("backfills older foods not yet recorded and not covered by the seed", () => {
    const kv = kvItems(["v6:gyro", "v6:pizza", "v5:lasagna", "v6:ramen"], "7");
    const result = basePlan({
      kv,
      recorded: new Set(["ramen"]),
      backfill: true,
      tokensPerCall: 10_000,
    });
    expect(result.backfill.items).toEqual(["pizza", "lasagna"]);
    expect(result.backfill).toMatchObject({ asked: 4, recorded: 1, seeded: 1 });
    expect(result.backfill.firstSeen).toBe(Date.parse("2026-09-23T00:00:00Z"));
    expect(result.backfill.usd).toBeCloseTo(0.00084, 8);
    expect(result.kvWrites).toBe(4);
    expect(result.d1Rows).toBe(4 * 7 + 2);
    expect(basePlan({ kv }).backfill.items).toEqual([]);
  });

  it("refuses to pass today's KV write margin", () => {
    const entries = Array.from({ length: 200 }, (_, i) => entry(`food ${i}`));
    expect(basePlan({ entries, usageCalls: KV_WRITE_CEILING - 200 }).refusals).toEqual([]);
    const [refusal] = basePlan({ entries, usageCalls: KV_WRITE_CEILING - 199 }).refusals;
    expect(refusal).toMatch(/200 KV writes would pass today's margin of 199/);
    expect(basePlan({ entries, usageCalls: 5000 }).refusals[0]).toMatch(/margin of 0 /);
  });

  it("warns when the Function's daily Jev calls plus the one-off KV writes can pass 1,000", () => {
    const entries = Array.from({ length: 186 }, (_, i) => entry(`food ${i}`));
    const kv = kvItems(["v6:pizza", "v6:ramen"], "7");
    const result = basePlan({ entries, kv, backfill: true, usageCalls: 28 });
    expect(result.kvOverrun).toEqual({ oneOff: 186, dailyCallLimit: 1000, worstCase: 1186 });
    expect(result.refusals).toEqual([]);
    expect(basePlan({ entries, dailyCallLimit: 814 }).kvOverrun).toBe(null);
    expect(basePlan({ entries: [], kv, backfill: true }).kvOverrun).toBe(null);
    expect(basePlan({ entries, dailyCallLimit: 0, usageCalls: 900 }).kvOverrun).toMatchObject({
      worstCase: 1086,
    });
  });

  it("writes nothing to KV and refuses nothing when everything is stored", () => {
    const result = basePlan({
      kv: { ...emptyKv(), current: new Set(["gyro", "hot dog"]) },
      recorded: new Set(["gyro", "hot dog"]),
      usageCalls: 5000,
    });
    expect([result.kvWrites, result.d1Rows, result.refusals]).toEqual([0, 0, []]);
  });

  it("refuses eval rulings fetched within the last hour", () => {
    const [refusal] = basePlan({ entries: [entry("gyro", NOW - 3_599_000)] }).refusals;
    expect(refusal).toMatch(/fetched less than an hour ago.*after 2026-09-23 20:01 UTC/);
    expect(basePlan({ entries: [entry("gyro", NOW - 3_600_000)] }).refusals).toEqual([]);
  });

  it("refuses a backfill before 01:00 UTC, when 00:00 still counts as the last hour", () => {
    const kv = kvItems(["v6:pizza"], "7");
    const early = Date.parse("2026-09-23T00:59:00Z");
    const refusals = basePlan({ kv, backfill: true, now: early, entries: [] }).refusals;
    expect(refusals).toEqual([expect.stringMatching(/after 01:00 UTC/)]);
    expect(basePlan({ kv, backfill: true, entries: [] }).refusals).toEqual([]);
  });

  it("refuses a backfill estimated over --max-usd", () => {
    const kv = kvItems(["v6:pizza", "v6:ramen"], "7");
    const refusals = basePlan({
      kv,
      backfill: true,
      maxUsd: 0.0005,
      tokensPerCall: 10_000,
    }).refusals;
    expect(refusals).toEqual([expect.stringMatching(/2 Jev calls .* over --max-usd 0.0005/)]);
  });

  it("prints the counts behind the plan", () => {
    const kv = kvItems(["v6:pizza"], "7");
    const result = basePlan({ kv, backfill: true, recorded: new Set(["gyro"]), usageCalls: 12 });
    const text = formatPlan(result, {
      source: "local D1 and KV",
      questionSet: "7",
      apply: false,
      total: 10,
      seedable: 2,
      skipped: new Map([["declined", 8]]),
      kvKeys: 1,
      lookups: 1,
    });
    expect(text).toContain(
      "Dry run: seeding the docket for question set 7 in the local D1 and KV.",
    );
    expect(text).toContain("2 listable (left out: 8 declined)");
    expect(text).toContain("D1: 1 new ruling");
    expect(text).toContain("1 already recorded");
    expect(text).toContain("Jev: 1 call");
    expect(text).toContain("KV: 3 writes. Today's margin is 888: 900 minus 12 Jev calls");
    const context = {
      source: "production D1 and KV",
      questionSet: "7",
      apply: false,
      total: 2,
      seedable: 2,
      skipped: new Map(),
      kvKeys: 0,
      lookups: 1,
    };
    expect(formatPlan(basePlan({ dailyCallLimit: 998 }), context)).not.toContain(
      "DAILY_CALL_LIMIT",
    );
    expect(formatPlan(basePlan({ dailyCallLimit: 1000 }), context)).toContain(
      "The 2 seed KV writes do not count toward DAILY_CALL_LIMIT (1,000), so if Jev calls reach it today, KV passes 1,000 writes (1,002) and later rulings go unstored. Run the seed late in the UTC day, or deploy DAILY_CALL_LIMIT 998 until 00:00 UTC.",
    );
    expect(text).toContain("Nothing was written.");
    expect(text).not.toMatch(new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`));
  });
});

describe("inlineSql", () => {
  it("quotes strings, writes NULL and numbers, and never rescans a value", () => {
    expect(inlineSql("SELECT ?1, ?2, ?3, ?10", ["it's ?2", null, 0.25, 1, 5, 6, 7, 8, 9, 10])).toBe(
      "SELECT 'it''s ?2', NULL, 0.25, 10",
    );
  });

  it("refuses a missing value or a number D1 cannot store", () => {
    expect(() => inlineSql("SELECT ?2", ["x"])).toThrow(/no value for \?2/);
    expect(() => inlineSql("SELECT ?1", [Number.NaN])).toThrow(/cannot write NaN/);
    expect(() => inlineSql("SELECT ?1", [{}])).toThrow(/cannot write a object/);
  });
});

describe("rulingStatements", () => {
  const readBack = (db) =>
    db.sqlite.prepare("SELECT * FROM rulings ORDER BY question_set, item").all();

  it("writes exactly what the Function's recordRuling writes, quotes included", async () => {
    const items = ["s'more", "o'brien's ''pie''", "x'); DROP TABLE rulings; --", "gyro ?1"];
    const at = Date.parse("2026-09-23T16:12:00.999Z");
    const bound = fakeD1();
    for (const item of items) await recordRuling({ DB: bound.binding }, item, listable(item), at);

    const inlined = fakeD1();
    const statements = await rulingStatements(
      items.map((item) => ({ item, response: listable(item), at })),
    );
    expect(statements).toHaveLength(items.length);
    inlined.sqlite.exec(`${statements.join(";\n")};`);

    const rows = readBack(inlined);
    expect(rows).toEqual(readBack(bound));
    expect(rows.map((row) => row.item).sort()).toEqual([...items].sort());
    for (const row of rows) {
      expect(row).toMatchObject({
        question_set: QUESTION_SET_VERSION,
        listed: 1,
        reason: "listed",
        asks: 1,
        first_seen: Math.floor(at / 1000),
      });
    }
  });

  it("records a hidden ruling as hidden, as the Function does", async () => {
    const db = fakeD1();
    const response = mockCubeResponse("my boss");
    const statements = await rulingStatements([{ item: "my boss", response, at: NOW }]);
    db.sqlite.exec(statements[0]);
    expect(readBack(db)).toMatchObject([
      { item: "my boss", listed: 0, reason: "private_person", asks: 1 },
    ]);
  });

  it("changes nothing when a rerun meets an already recorded item", async () => {
    const db = fakeD1();
    const rows = [{ item: "gyro", response: listable("gyro"), at: NOW }];
    const [first] = await rulingStatements(rows);
    db.sqlite.exec(first);
    const before = readBack(db);
    db.sqlite.exec((await rulingStatements([{ ...rows[0], at: NOW + 1000 }]))[0]);
    const after = readBack(db);
    expect(after).toHaveLength(1);
    if (MIN_ASKS === 1) expect(after).toEqual(before);
    else expect(after[0].first_seen).toBe(before[0].first_seen);
  });
});

describe("usageStatements", () => {
  it("adds each day's calls and tokens, counting a failed call without tokens", () => {
    const db = fakeD1();
    db.sqlite.exec(
      "INSERT INTO usage (day, calls, input_tokens, token_calls) VALUES ('2026-09-23', 10, 100, 9)",
    );
    const statements = usageStatements([
      { day: "2026-09-23", tokens: 9000 },
      { day: "2026-09-23", tokens: 0 },
      { day: "2026-09-24", tokens: 8000 },
    ]);
    for (const sql of statements) db.sqlite.exec(sql);
    expect(db.sqlite.prepare("SELECT * FROM usage ORDER BY day").all()).toEqual([
      { day: "2026-09-23", calls: 12, input_tokens: 9100, token_calls: 10 },
      { day: "2026-09-24", calls: 1, input_tokens: 8000, token_calls: 1 },
    ]);
    expect(usageStatements([])).toEqual([]);
  });
});

describe("lookups", () => {
  it("reads recorded items by primary key in bounded chunks, quoting each item", () => {
    const db = fakeD1();
    db.sqlite.exec(
      "INSERT INTO rulings (question_set, item, kind, listed, reason, asks, first_seen) VALUES ('7', 's''more', 'food', 1, 'listed', 1, 0), ('6', 'gyro', 'food', 1, 'listed', 1, 0)",
    );
    const items = ["s'more", "gyro", ...Array.from({ length: 450 }, (_, i) => `food ${i}`)];
    const statements = lookupStatements(items, "7");
    expect(statements).toHaveLength(3);
    const found = statements.flatMap((sql) => {
      const plan = db.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
      expect(plan.map((row) => row.detail).filter((step) => /^SCAN /.test(step))).toEqual([]);
      return db.sqlite.prepare(sql).all();
    });
    expect(found).toEqual([{ item: "s'more" }]);
    expect(lookupStatements([], "7")).toEqual([]);
    expect(usageStatement(NOW)).toBe("SELECT calls FROM usage WHERE day = '2026-09-23'");
  });
});

describe("kvPairs", () => {
  it("stores the same body the Function stores after a Jev call", () => {
    const response = listable("gyro");
    expect(kvPairs([{ item: "s'more", response: { ...response, extra: 1 } }], "7")).toEqual([
      {
        key: "v7:s'more",
        value: JSON.stringify({ model: response.model, answers: response.answers }),
      },
    ]);
  });
});

describe("askJev", () => {
  const client = (answer) => ({ systemOne: async (request) => answer(request.state.item) });

  it("keeps valid answers, counts every call and stops before --max-usd", async () => {
    const result = await askJev(["gyro", "broken", "down", "pizza", "ramen"], {
      client: client((item) => {
        if (item === "down") throw Object.assign(new Error("boom"), { status: 503 });
        if (item === "broken")
          return { model: CUBE_MODEL, answers: {}, usage: { input_tokens: 9 } };
        return { ...listable(item), usage: { input_tokens: 10_000 } };
      }),
      maxUsd: 0.0012,
      tokensPerCall: 10_000,
      clock: () => NOW,
    });
    expect(result.answered.map((a) => a.item)).toEqual(["gyro"]);
    expect(result.answered[0].response).toEqual(listable("gyro"));
    expect(result.failures).toEqual(["UnexpectedResponseShape", "Error 503"]);
    expect(result.calls).toEqual([
      { day: "2026-09-23", tokens: 10_000 },
      { day: "2026-09-23", tokens: 9 },
      { day: "2026-09-23", tokens: 0 },
    ]);
    expect(result.skipped).toBe(2);
  });

  it("asks nothing when even one call would pass --max-usd", async () => {
    const result = await askJev(["gyro"], {
      client: client(() => {
        throw new Error("never called");
      }),
      maxUsd: 0,
      tokensPerCall: 10_000,
    });
    expect(result).toMatchObject({ answered: [], calls: [], skipped: 1 });
  });
});

describe("rowsPerRuling", () => {
  it("counts the table row and every index a one-ask ruling can enter", async () => {
    const db = fakeD1();
    const indexes = db.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'rulings'")
      .all()
      .map((row) => String(row.sql));
    const v12 = indexes.filter((sql) => /asks >= 2\b/.test(sql));
    expect(v12).toHaveLength(4);
    expect(await rowsPerRuling()).toBe(1 + indexes.length - v12.length);
    expect(await rowsPerRuling()).toBe(7);
    expect(startOfUtcDay(NOW)).toBe(Date.parse("2026-09-23T00:00:00Z"));
  });
});

describe("rowsWritten", () => {
  it("reads D1's count when it reports one", () => {
    const remote = JSON.stringify([
      {
        results: [{ "Total queries executed": 190, "Rows written": 1250 }],
        success: true,
        meta: { rows_read: 190, rows_written: 1250 },
      },
    ]);
    expect(rowsWritten(`banner\n${remote}`)).toBe(1250);
    expect(rowsWritten(JSON.stringify([{ meta: { rows_written: 3 } }, { meta: {} }]))).toBe(3);
    expect(rowsWritten(JSON.stringify([{ results: [{ 1: 1 }], meta: { duration: 1 } }]))).toBe(
      null,
    );
    expect(rowsWritten("no json here")).toBe(null);
  });
});

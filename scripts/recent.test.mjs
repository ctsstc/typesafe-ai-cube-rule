import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MIN_ASKS } from "../apps/web/functions/_lib/rulings.ts";
import {
  DEFAULT_LIMIT,
  formatBlocklist,
  formatChange,
  formatPrune,
  formatRulings,
  formatSwitch,
  MAX_LIMIT,
  PRUNE_BATCH,
  parseOptions,
  pruneStatements,
  ROWS_PER_DELETE,
  report,
  statements,
  status,
  UsageError,
} from "./recent.mjs";

const NOW = Date.parse("2026-09-23T12:00:00Z");
const CONTEXT = { questionSet: "7", source: "local D1" };

// node:sqlite prints an ExperimentalWarning on first load, which would clutter pnpm check.
const { DatabaseSync } = await (async () => {
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  try {
    return await import("node:sqlite");
  } finally {
    process.emitWarning = emit;
  }
})();

function database() {
  const migrations = fileURLToPath(new URL("../apps/web/migrations/", import.meta.url));
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrations).sort()) {
    db.exec(readFileSync(`${migrations}${file}`, "utf8"));
  }
  const insert = db.prepare(
    `INSERT INTO rulings (question_set, item, kind, category, wet, confidence, runner_up, official,
      debate_level, listed, reason, asks, first_seen, person_none, person_public, person_private,
      abusive)
    VALUES ('7', ?, ?, ?, 0, ?, NULL, ?, 1, ?, ?, ?, ?, 0.99, 0, 0.01, 0.01)`,
  );
  insert.run("hot dog", "food", "sandwich", 0.61, "taco", 1, "listed", 2, NOW / 1000 - 60);
  insert.run("o'brien's pie", "food", "quiche", 0.9, null, 1, "listed", 1, NOW / 1000 - 30);
  insert.run("my boss", "honorary", "calzone", 0.5, null, 0, "private_person", 2, NOW / 1000 - 20);
  insert.run("a slur", "declined", null, null, null, 0, "declined", 1, NOW / 1000 - 10);
  insert.run("stale", "food", "toast", 0.7, null, 1, "listed", 2, NOW / 1000 - 5);
  db.exec("UPDATE rulings SET question_set = '6' WHERE item = 'stale'");
  return db;
}

it("budgets a prune delete for a row in the table and every index", () => {
  const { n } = database()
    .prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = 'rulings'",
    )
    .get();
  expect(ROWS_PER_DELETE).toBe(1 + Number(n));
});

const run = (db, options) =>
  statements(options, { now: NOW, questionSet: "7" }).map((sql) => db.prepare(sql).all());

describe("parseOptions", () => {
  it("lists listed rulings by default", () => {
    expect(parseOptions([])).toEqual({
      action: "list",
      flagged: false,
      limit: DEFAULT_LIMIT,
      local: false,
    });
  });

  it("reads --flagged, --limit and --local", () => {
    expect(parseOptions(["--flagged", "--limit", "5", "--local"])).toEqual({
      action: "list",
      flagged: true,
      limit: 5,
      local: true,
    });
  });

  it("normalizes a blocked item the way the app does", () => {
    expect(parseOptions(["--block", "  “Hot   DOG”?! "])).toEqual({
      action: "block",
      item: "hot dog",
      typed: "  “Hot   DOG”?! ",
      local: false,
    });
    expect(parseOptions(["--unblock=Pizza", "--local"])).toMatchObject({
      action: "unblock",
      item: "pizza",
      local: true,
    });
    expect(parseOptions(["--blocklist"])).toEqual({ action: "blocklist", local: false });
    expect(parseOptions(["-h"])).toEqual({ action: "help" });
  });

  it.each([
    [["--block", "a", "--unblock", "b"], /Pick one of --block, --unblock/],
    [["--blocklist", "--block", "a"], /Pick one/],
    [["--block", "a", "--flagged"], /only apply to the listing/],
    [["--blocklist", "--limit", "3"], /only apply to the listing/],
    [["--block", "?!"], /--block needs an item/],
    [["--block"], /argument missing/],
    [["--limit", "0"], /1 to 500/],
    [["--limit", String(MAX_LIMIT + 1)], /1 to 500/],
    [["--limit", "2.5"], /1 to 500/],
    [["--delete"], /Unknown option/],
    [["--lists", "maybe"], /on or off/],
    [["--lists", "off", "--block", "x"], /Pick one/],
    [["--yes"], /only applies to --prune/],
    [["--prune", "--flagged"], /only apply to the listing/],
    [["pizza"], /Unexpected argument/],
  ])("refuses %j", (argv, message) => {
    expect(() => parseOptions(argv)).toThrow(UsageError);
    expect(() => parseOptions(argv)).toThrow(message);
  });
});

describe("statements", () => {
  it("writes only for --block, --unblock, --lists and --prune --yes", () => {
    for (const argv of [[], ["--flagged"], ["--blocklist"], ["--prune"]]) {
      for (const sql of statements(parseOptions(argv), { now: NOW })) {
        expect(sql).toMatch(/^SELECT /);
      }
    }
    const [block] = statements(parseOptions(["--block", "x"]), { now: NOW });
    const [unblock] = statements(parseOptions(["--unblock", "x"]), { now: NOW });
    const [lists] = statements(parseOptions(["--lists", "off"]), { now: NOW });
    expect(block).toMatch(/^INSERT INTO blocklist /);
    expect(unblock).toMatch(/^DELETE FROM blocklist /);
    expect(lists).toMatch(/^INSERT INTO switches /);
    for (const sql of statements(parseOptions(["--prune", "--yes"]), { now: NOW })) {
      expect(sql).toMatch(/^SELECT /);
    }
  });

  it("switches every list off and on", () => {
    const db = database();
    expect(run(db, parseOptions(["--lists", "OFF"]))).toEqual([[{ value: "off" }]]);
    expect(run(db, parseOptions([]))[1]).toEqual([{ value: "off" }]);
    expect(run(db, parseOptions(["--lists", "on"]))).toEqual([[{ value: "on" }]]);
    expect(db.prepare("SELECT * FROM switches").all()).toEqual([
      { name: "lists", value: "on", changed_at: NOW / 1000 },
    ]);
  });

  it("counts other question sets, then deletes them in bounded batches", () => {
    const db = database();
    const insert = db.prepare(
      "INSERT INTO rulings (question_set, item, kind, listed, reason, asks, first_seen) VALUES ('10', ?, 'food', 1, 'listed', 2, 0)",
    );
    for (const item of ["a", "b", "c"]) insert.run(item);
    const [counts] = run(db, parseOptions(["--prune", "--yes"]));
    expect(counts).toEqual(
      expect.arrayContaining([
        { question_set: "6", rulings: 1 },
        { question_set: "10", rulings: 3 },
      ]),
    );
    expect(counts).toHaveLength(2);
    const deletes = pruneStatements(counts, 3);
    for (const sql of [...statements(parseOptions(["--prune"]), { now: NOW }), ...deletes]) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
      expect(plan.map((row) => row.detail).filter((step) => /^SCAN /.test(step))).toEqual([]);
      db.prepare(sql).all();
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM rulings WHERE question_set = '7'").get()).toEqual({
      n: 4,
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM rulings WHERE question_set <> '7'").get()).toEqual(
      {
        n: 1,
      },
    );
    expect(pruneStatements([{ question_set: "6", rulings: 5000 }])[0]).toContain(
      `LIMIT ${PRUNE_BATCH}`,
    );
  });

  it("reads the newest listed rulings of the current question set", () => {
    const db = database();
    const [rows] = run(db, parseOptions([]));
    expect(rows.map((row) => [row.item, row.blocked])).toEqual([
      ["o'brien's pie", 0],
      ["hot dog", 0],
    ]);
    const [flagged] = run(db, parseOptions(["--flagged", "--limit", "3"]));
    expect(flagged.map((row) => row.item)).toEqual(["a slur", "my boss", "o'brien's pie"]);
  });

  it("uses the first_seen index, never a table scan", () => {
    const db = database();
    const [sql] = statements(parseOptions(["--flagged"]), { now: NOW });
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
    expect(plan.map((row) => row.detail).filter((step) => /^SCAN /.test(step))).toEqual([]);
  });

  it("blocks and unblocks once, quoting the item safely", () => {
    const db = database();
    const block = parseOptions(["--block", "O'Brien's pie"]);
    expect(run(db, block)).toEqual([
      [{ item: "o'brien's pie" }],
      [
        {
          item: "o'brien's pie",
          listed: 1,
          reason: "listed",
          asks: 1,
          person_none: 0.99,
          person_public: 0,
          person_private: 0.01,
          abusive: 0.01,
        },
      ],
    ]);
    expect(run(db, block)[0]).toEqual([]);
    expect(db.prepare("SELECT * FROM blocklist").all()).toEqual([
      { item: "o'brien's pie", added_at: NOW / 1000 },
    ]);
    const [listed] = run(db, parseOptions([]));
    expect(listed.find((row) => row.item === "o'brien's pie")?.blocked).toBe(1);

    const unblock = parseOptions(["--unblock", "o'brien's pie"]);
    expect(run(db, unblock)[0]).toEqual([{ item: "o'brien's pie" }]);
    expect(run(db, unblock)[0]).toEqual([]);
  });

  it("keeps an injection attempt a plain string", () => {
    const db = database();
    const sneaky = "x'); DROP TABLE rulings; --";
    run(db, parseOptions(["--block", sneaky]));
    expect(db.prepare("SELECT item FROM blocklist").all()).toEqual([
      { item: "x'); drop table rulings; --" },
    ]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM rulings").get()).toEqual({ n: 5 });
  });
});

describe("status", () => {
  const scores = { person_none: 0.99, person_public: 0, person_private: 0.01, abusive: 0.01 };
  it.each([
    [{ blocked: 1, listed: 1, asks: 1 }, "blocked"],
    [{ blocked: 0, listed: 0, reason: "declined", asks: 1 }, "hidden: declined"],
    [{ blocked: 0, listed: 1, asks: MIN_ASKS - 1, ...scores }, `waiting, 0 of ${MIN_ASKS} asks`],
    [{ blocked: 0, listed: 1, asks: 1, ...scores }, "public"],
    [{ blocked: 0, listed: 1, asks: 2, ...scores }, "public"],
    [
      { blocked: 0, listed: 1, asks: 2, ...scores, person_private: 0.12 },
      "hidden now: private_person",
    ],
    [{ blocked: 0, listed: 1, asks: 2, ...scores, abusive: null }, "hidden now: abusive"],
    [{ blocked: 0, listed: 1, asks: 2 }, "hidden now: private_person"],
  ])("reads %j as %s", (row, expected) => {
    expect(status({ item: "gyro", ...row })).toBe(expected);
  });

  it("rechecks personal info with today's rules", () => {
    expect(status({ item: "acme dot ai", blocked: 0, listed: 1, asks: 2, ...scores })).toBe(
      "hidden now: personal_info",
    );
  });
});

describe("formatRulings", () => {
  const row = {
    item: "hot dog",
    kind: "food",
    category: "sandwich",
    official: "taco",
    confidence: 0.612,
    listed: 1,
    reason: "listed",
    asks: 2,
    first_seen: NOW / 1000,
    blocked: 0,
    person_none: 0.99,
    person_public: 0,
    person_private: 0.01,
    abusive: 0.01,
  };

  it("prints a table with the status of each ruling", () => {
    const text = formatRulings(
      [
        row,
        { ...row, item: "pizza", official: null, confidence: 0.9, asks: 1 },
        {
          ...row,
          item: "a slur",
          kind: "declined",
          category: null,
          official: null,
          confidence: null,
          listed: 0,
          reason: "declined",
          asks: 1,
        },
      ],
      { flagged: true, limit: 30, ...CONTEXT },
    );
    expect(text.split("\n")).toEqual([
      "Every ruling for question set 7 in the local D1, newest first (up to 30).",
      "",
      "First seen (UTC)  Item     Kind      Cube                Conf  Status            Private  Sure  Abusive",
      "2026-09-23 12:00  hot dog  food      taco, Jev sandwich  0.61  public            0.01     0.99  0.01",
      "2026-09-23 12:00  pizza    food      sandwich            0.90  public            0.01     0.99  0.01",
      "2026-09-23 12:00  a slur   declined  -                   -     hidden: declined  0.01     0.99  0.01",
      "",
      "Public means listed, asked at least once, not blocked and within the current bars.",
      "This includes declined and hidden text. Keep it to your own terminal.",
    ]);
  });

  it("says when every list is switched off", () => {
    const text = formatRulings([], { flagged: false, limit: 30, ...CONTEXT, listsOff: true });
    expect(text).toContain("Every public list is switched off.");
  });

  it("says how to see hidden rulings when there are none to show", () => {
    const text = formatRulings([], { flagged: false, limit: 30, ...CONTEXT });
    expect(text).toContain("No listed rulings yet.");
    expect(text).toContain("Add --flagged to see them.");
  });

  it("never prints control or bidi characters", () => {
    const text = formatRulings([{ ...row, item: "pie\u202e\u001b[2Jx" }], {
      flagged: false,
      limit: 30,
      ...CONTEXT,
    });
    expect(text).toContain("pie  [2Jx");
    expect(text).not.toContain("\u202e");
    expect(text).not.toContain("\u001b");
  });
});

describe("formatChange", () => {
  const block = { action: "block", item: "hot dog", typed: "Hot Dog!" };
  const unblock = { ...block, action: "unblock" };
  const listed = {
    item: "hot dog",
    listed: 1,
    reason: "listed",
    asks: 2,
    person_none: 0.99,
    person_public: 0,
    person_private: 0.01,
    abusive: 0.01,
  };

  it("confirms a block and what it hides", () => {
    expect(formatChange(block, [[{ item: "hot dog" }], [listed]], CONTEXT).split("\n")).toEqual([
      'Blocked "hot dog" (normalized from "Hot Dog!") in the local D1.',
      "The lists drop it once their 2 minute edge and browser copies expire.",
      "Status of its question set 7 ruling before the block: public.",
    ]);
    expect(formatChange(block, [[{ item: "hot dog" }], []], CONTEXT)).toContain(
      "stays out of the lists while blocked",
    );
    expect(formatChange(block, [[], [listed]], CONTEXT)).toBe(
      '"hot dog" was already blocked in the local D1.',
    );
  });

  it("confirms an unblock and whether the item comes back", () => {
    expect(
      formatChange({ ...unblock, typed: "hot dog" }, [[{ item: "hot dog" }], [listed]], CONTEXT),
    ).toBe('Unblocked "hot dog" in the local D1.\nStatus of its question set 7 ruling: public.');
    expect(formatChange(unblock, [[], []], CONTEXT)).toBe(
      '"hot dog" was not blocked in the local D1.',
    );
  });
});

describe("report", () => {
  it("formats each action's results", () => {
    const db = database();
    run(db, parseOptions(["--block", "hot dog"]));
    const options = parseOptions(["--blocklist"]);
    expect(report(options, run(db, options), CONTEXT)).toBe(
      [
        "Blocked items in the local D1:",
        "",
        "Item     Added (UTC)",
        "hot dog  2026-09-23 12:00",
      ].join("\n"),
    );
    expect(formatBlocklist([], CONTEXT)).toBe("The blocklist in the local D1 is empty.");
    expect(formatSwitch({ state: "off" }, [[{ value: "off" }]], CONTEXT)).toContain(
      "Every public list is off in the local D1.",
    );
    expect(formatPrune({ yes: false }, [[{ question_set: "6", rulings: 3 }]], CONTEXT)).toContain(
      `Run pnpm recent --prune --yes to delete up to ${PRUNE_BATCH} of them.`,
    );
    expect(formatPrune({ yes: true }, [[{ question_set: "6", rulings: 3 }]], CONTEXT)).toBe(
      "3 rulings in the local D1 belong to other question sets and are never read: 3 from question set 6.\nDeleted 3.",
    );
    expect(
      formatPrune({ yes: true }, [[{ question_set: "6", rulings: PRUNE_BATCH + 5 }]], CONTEXT),
    ).toContain(
      "Run it again for the other 5, one batch at a time: each batch writes up to about 22,000 rows",
    );
    expect(formatPrune({ yes: true }, [[]], CONTEXT)).toBe(
      "No rulings from other question sets than 7 in the local D1.",
    );
  });
});

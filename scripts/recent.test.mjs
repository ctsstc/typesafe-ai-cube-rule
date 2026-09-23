import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMIT,
  formatBlocklist,
  formatChange,
  formatRulings,
  MAX_LIMIT,
  parseOptions,
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
    `INSERT INTO rulings VALUES ('7', ?, ?, ?, 0, ?, NULL, ?, 1, ?, ?, ?, ?)`,
  );
  insert.run("hot dog", "food", "sandwich", 0.61, "taco", 1, "listed", 2, NOW / 1000 - 60);
  insert.run("o'brien's pie", "food", "quiche", 0.9, null, 1, "listed", 1, NOW / 1000 - 30);
  insert.run("my boss", "honorary", "calzone", 0.5, null, 0, "private_person", 2, NOW / 1000 - 20);
  insert.run("a slur", "declined", null, null, null, 0, "declined", 1, NOW / 1000 - 10);
  insert.run("stale", "food", "toast", 0.7, null, 1, "listed", 2, NOW / 1000 - 5);
  db.exec("UPDATE rulings SET question_set = '6' WHERE item = 'stale'");
  return db;
}

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
    [["pizza"], /Unexpected argument/],
  ])("refuses %j", (argv, message) => {
    expect(() => parseOptions(argv)).toThrow(UsageError);
    expect(() => parseOptions(argv)).toThrow(message);
  });
});

describe("statements", () => {
  it("only writes to the blocklist, and only for --block and --unblock", () => {
    for (const argv of [[], ["--flagged"], ["--blocklist"]]) {
      for (const sql of statements(parseOptions(argv), { now: NOW })) {
        expect(sql).toMatch(/^SELECT /);
      }
    }
    const [block] = statements(parseOptions(["--block", "x"]), { now: NOW });
    const [unblock] = statements(parseOptions(["--unblock", "x"]), { now: NOW });
    expect(block).toMatch(/^INSERT INTO blocklist /);
    expect(unblock).toMatch(/^DELETE FROM blocklist /);
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
      [{ listed: 1, reason: "listed", asks: 1 }],
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
  it.each([
    [{ blocked: 1, listed: 1, asks: 2 }, "blocked"],
    [{ blocked: 0, listed: 0, reason: "declined", asks: 1 }, "hidden: declined"],
    [{ blocked: 0, listed: 1, asks: 1 }, "waiting, 1 of 2 asks"],
    [{ blocked: 0, listed: 1, asks: 2 }, "public"],
  ])("reads %j as %s", (row, expected) => {
    expect(status(row)).toBe(expected);
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
      "First seen (UTC)  Item     Kind      Cube                Conf  Asks  Status",
      "2026-09-23 12:00  hot dog  food      taco, Jev sandwich  0.61  2     public",
      "2026-09-23 12:00  pizza    food      sandwich            0.90  1     waiting, 1 of 2 asks",
      "2026-09-23 12:00  a slur   declined  -                   -     1     hidden: declined",
      "",
      "Public means listed, at least 2 asks and not blocked.",
      "This includes declined and hidden text. Keep it to your own terminal.",
    ]);
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
  const listed = { listed: 1, reason: "listed", asks: 2 };

  it("confirms a block and what it hides", () => {
    expect(formatChange(block, [[{ item: "hot dog" }], [listed]], CONTEXT).split("\n")).toEqual([
      'Blocked "hot dog" (normalized from "Hot Dog!") in the local D1.',
      "The lists drop it once their 2 minute edge and browser copies expire.",
      "Status of its question set 7 ruling before the block: public.",
    ]);
    expect(formatChange(block, [[{ item: "hot dog" }], []], CONTEXT)).toContain(
      "One recorded later is stored as blocked.",
    );
    expect(formatChange(block, [[], [listed]], CONTEXT)).toBe(
      '"hot dog" was already blocked in the local D1.',
    );
  });

  it("confirms an unblock and whether the item comes back", () => {
    expect(
      formatChange({ ...unblock, typed: "hot dog" }, [[{ item: "hot dog" }], [listed]], CONTEXT),
    ).toBe('Unblocked "hot dog" in the local D1.\nStatus of its question set 7 ruling: public.');
    const recordedBlocked = { listed: 0, reason: "blocked", asks: 1 };
    expect(formatChange(unblock, [[{ item: "hot dog" }], [recordedBlocked]], CONTEXT)).toContain(
      "stays hidden until the next question set",
    );
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
  });
});

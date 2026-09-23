#!/usr/bin/env node
// Owner-only view of the rulings the public lists draw from. See docs/deploy.md#public-lists.
// Runs under tsx (see the root package.json) because it imports @cube/core's TypeScript source.
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { MIN_ASKS } from "../apps/web/functions/_lib/rulings.ts";
import {
  hasPersonalInfo,
  listingBar,
  normalizeItem,
  QUESTION_SET_VERSION,
} from "../packages/core/src/index.ts";
import { PRODUCTION_CONFIG, writeProductionConfig } from "./cloudflare-config.mjs";

const DATABASE = "cube-rule-oracle";
export const DEFAULT_LIMIT = 30;
export const MAX_LIMIT = 500;
const LISTS_TTL_MINUTES = 2;

export const USAGE = `Usage:
  pnpm recent [--flagged] [--limit <n>] [--local]   newest rulings, read-only
  pnpm recent --block "<item>" [--local]            hide an item from the public lists
  pnpm recent --unblock "<item>" [--local]          show it again
  pnpm recent --blocklist [--local]                 list blocked items
  pnpm recent --lists off|on [--local]              hide or show every public list, no deploy
  pnpm recent --prune [--yes] [--local]             count, then with --yes delete, rulings
                                                    from older question sets

--flagged also shows declined and hidden rulings, for your terminal only.
--local uses the local D1 from pnpm dev instead of production.`;

const web = fileURLToPath(new URL("../apps/web", import.meta.url));

export class UsageError extends Error {}

export function parseOptions(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        flagged: { type: "boolean" },
        limit: { type: "string" },
        local: { type: "boolean" },
        block: { type: "string" },
        unblock: { type: "string" },
        blocklist: { type: "boolean" },
        lists: { type: "string" },
        prune: { type: "boolean" },
        yes: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (values.help) return { action: "help" };
  const local = values.local ?? false;
  const actions = ["block", "unblock", "blocklist", "lists", "prune"].filter(
    (name) => values[name] !== undefined,
  );
  if (actions.length > 1) {
    throw new UsageError(`Pick one of ${actions.map((name) => `--${name}`).join(", ")}.`);
  }
  const action = actions[0] ?? "list";
  if (action !== "list" && (values.flagged || values.limit !== undefined)) {
    throw new UsageError("--flagged and --limit only apply to the listing.");
  }
  if (action !== "prune" && values.yes) throw new UsageError("--yes only applies to --prune.");
  if (action === "prune") return { action, yes: values.yes ?? false, local };
  if (action === "lists") {
    const state = values.lists.trim().toLowerCase();
    if (state !== "on" && state !== "off") throw new UsageError("--lists takes on or off.");
    return { action, state, local };
  }
  if (action === "block" || action === "unblock") {
    const typed = values[action];
    const item = normalizeItem(typed);
    if (!item) throw new UsageError(`--${action} needs an item.`);
    return { action, item, typed, local };
  }
  if (action === "blocklist") return { action, local };
  const limit = values.limit === undefined ? DEFAULT_LIMIT : Number(values.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new UsageError(`--limit takes a whole number from 1 to ${MAX_LIMIT}.`);
  }
  return { action, flagged: values.flagged ?? false, limit, local };
}

export const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;

const LISTS_SWITCH = "SELECT value FROM switches WHERE name = 'lists'";

export function statements(options, { now, questionSet = QUESTION_SET_VERSION }) {
  const set = sqlString(questionSet);
  if (options.action === "list") {
    return [
      `SELECT r.item, r.kind, r.category, r.official, r.confidence, r.person_none, r.person_public, r.person_private, r.abusive, r.listed, r.reason, r.asks, r.first_seen, EXISTS (SELECT 1 FROM blocklist AS b WHERE b.item = r.item) AS blocked FROM rulings AS r INDEXED BY rulings_first_seen WHERE r.question_set = ${set}${options.flagged ? "" : " AND r.listed = 1"} ORDER BY r.first_seen DESC LIMIT ${options.limit}`,
      LISTS_SWITCH,
    ];
  }
  if (options.action === "blocklist") {
    return [`SELECT item, added_at FROM blocklist ORDER BY item LIMIT ${MAX_LIMIT}`];
  }
  if (options.action === "lists") {
    return [
      `INSERT INTO switches (name, value, changed_at) VALUES ('lists', ${sqlString(options.state)}, ${Math.floor(now / 1000)}) ON CONFLICT (name) DO UPDATE SET value = excluded.value, changed_at = excluded.changed_at RETURNING value`,
    ];
  }
  if (options.action === "prune") {
    // Two ranges rather than <>, so the count never reads the current question set's rows.
    const side = (op) =>
      `SELECT question_set, COUNT(*) AS rulings FROM rulings WHERE question_set ${op} ${set} GROUP BY question_set`;
    return [`${side("<")} UNION ALL ${side(">")}`];
  }
  const item = sqlString(options.item);
  const change =
    options.action === "block"
      ? `INSERT INTO blocklist (item, added_at) VALUES (${item}, ${Math.floor(now / 1000)}) ON CONFLICT (item) DO NOTHING RETURNING item`
      : `DELETE FROM blocklist WHERE item = ${item} RETURNING item`;
  return [
    change,
    `SELECT item, listed, reason, asks, person_none, person_public, person_private, abusive FROM rulings WHERE question_set = ${set} AND item = ${item}`,
  ];
}

// Mirrors /api/lists, which applies the current bars to every stored row.
// Deleting a row writes up to 11 rows (the table and every index), so a batch stays well inside
// 100,000 a day.
export const ROWS_PER_DELETE = 11;
export const PRUNE_BATCH = 2000;

/** Deletes for `pnpm recent --prune --yes`, from the counts its first statement returned. */
export function pruneStatements(counts, batch = PRUNE_BATCH) {
  const deletes = [];
  let left = batch;
  for (const row of counts) {
    const n = Math.min(left, Number(row.rulings));
    if (n <= 0) break;
    const set = sqlString(row.question_set);
    deletes.push(
      `DELETE FROM rulings WHERE question_set = ${set} AND item IN (SELECT item FROM rulings WHERE question_set = ${set} LIMIT ${n})`,
    );
    left -= n;
  }
  return deletes;
}

export function status(row) {
  if (row.blocked) return "blocked";
  if (!row.listed) return `hidden: ${row.reason}`;
  if (hasPersonalInfo(row.item)) return "hidden now: personal_info";
  const bar = listingBar(row.item, {
    personNone: row.person_none ?? null,
    personPublic: row.person_public ?? null,
    personPrivate: row.person_private ?? null,
    abusive: row.abusive ?? null,
  });
  if (bar) return `hidden now: ${bar}`;
  if (row.asks < MIN_ASKS) return `waiting, ${row.asks} of ${MIN_ASKS} asks`;
  return "public";
}

// Stored items are already normalized, but a bidi or control character must never reach the terminal.
const printable = (text) => String(text).replace(/[\p{Cc}\p{Cf}]/gu, " ");
const quoted = (item) => `"${printable(item)}"`;
const utc = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ");

function cube(row) {
  if (!row.category) return "-";
  if (row.official && row.official !== row.category) return `${row.official}, Jev ${row.category}`;
  return row.official ?? row.category;
}

function table(header, rows) {
  const widths = header.map((_, i) => Math.max(...[header, ...rows].map((row) => row[i].length)));
  return [header, ...rows]
    .map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  "))
    .map((line) => line.trimEnd())
    .join("\n");
}

const score = (value) => (value == null ? "-" : Number(value).toFixed(2));

export function formatRulings(rows, { flagged, limit, questionSet, source, listsOff = false }) {
  const scope = flagged ? "Every ruling" : "Listed rulings";
  const lines = [
    `${scope} for question set ${questionSet} in the ${source}, newest first (up to ${limit}).`,
    "",
  ];
  if (listsOff) {
    lines.push("Every public list is switched off. pnpm recent --lists on turns them back on.", "");
  }
  if (rows.length === 0) {
    lines.push(flagged ? "No rulings recorded yet." : "No listed rulings yet.");
  } else {
    const header = ["First seen (UTC)", "Item", "Kind", "Cube", "Conf", "Status"];
    const cells = (row) => [
      utc(row.first_seen),
      printable(row.item),
      row.kind,
      cube(row),
      score(row.confidence),
      status(row),
    ];
    lines.push(
      flagged
        ? table(
            [...header, "Private", "Sure", "Abusive"],
            rows.map((row) => {
              const sure =
                row.person_none == null || row.person_public == null
                  ? null
                  : Math.max(row.person_none, row.person_public);
              return [...cells(row), score(row.person_private), score(sure), score(row.abusive)];
            }),
          )
        : table(header, rows.map(cells)),
    );
  }
  lines.push(
    "",
    `Public means listed, asked at least ${MIN_ASKS === 1 ? "once" : `${MIN_ASKS} times`}, not blocked and within the current bars.`,
    flagged
      ? "This includes declined and hidden text. Keep it to your own terminal."
      : "Declined and hidden rulings are left out. Add --flagged to see them.",
  );
  return lines.join("\n");
}

export function formatChange(options, [changed = [], [ruling] = []], { questionSet, source }) {
  const item = quoted(options.item);
  const typed =
    options.typed.trim() === options.item ? "" : ` (normalized from ${quoted(options.typed)})`;
  const current = ruling && status({ ...ruling, blocked: false });
  if (options.action === "block") {
    if (changed.length === 0) return `${item} was already blocked in the ${source}.`;
    return [
      `Blocked ${item}${typed} in the ${source}.`,
      `The lists drop it once their ${LISTS_TTL_MINUTES} minute edge and browser copies expire.`,
      ruling
        ? `Status of its question set ${questionSet} ruling before the block: ${current}.`
        : `It has no question set ${questionSet} ruling yet, and stays out of the lists while blocked.`,
    ].join("\n");
  }
  if (changed.length === 0) return `${item} was not blocked in the ${source}.`;
  return [
    `Unblocked ${item}${typed} in the ${source}.`,
    ruling
      ? `Status of its question set ${questionSet} ruling: ${current}.`
      : `It has no question set ${questionSet} ruling yet.`,
  ].join("\n");
}

export function formatSwitch(options, [[changed] = []], { source }) {
  const state = changed?.value ?? options.state;
  const when = `once their ${LISTS_TTL_MINUTES} minute edge and browser copies expire`;
  return state === "off"
    ? `Every public list is off in the ${source}. /api/lists answers enabled false ${when}.\nRulings are still recorded. pnpm recent --lists on brings the lists back.`
    : `The public lists are on in the ${source}. They come back ${when}.`;
}

export function formatPrune(options, [counts = []], { questionSet, source }) {
  const total = counts.reduce((sum, row) => sum + Number(row.rulings), 0);
  if (total === 0)
    return `No rulings from other question sets than ${questionSet} in the ${source}.`;
  const sets = counts.map((row) => `${row.rulings} from question set ${row.question_set}`);
  const found = `${total} rulings in the ${source} belong to other question sets and are never read: ${sets.join(", ")}.`;
  if (!options.yes) {
    return `${found}\nRun pnpm recent --prune --yes to delete up to ${PRUNE_BATCH} of them.`;
  }
  const deleted = Math.min(total, PRUNE_BATCH);
  const left = total - deleted;
  return [
    found,
    `Deleted ${deleted}.${left > 0 ? ` Run it again for the other ${left}, one batch at a time: each batch writes up to about ${(PRUNE_BATCH * ROWS_PER_DELETE).toLocaleString("en-US")} rows, counting index rows, of D1's 100,000 a day.` : ""}`,
  ].join("\n");
}

export function formatBlocklist(rows, { source }) {
  if (rows.length === 0) return `The blocklist in the ${source} is empty.`;
  return [
    `Blocked items in the ${source}:`,
    "",
    table(
      ["Item", "Added (UTC)"],
      rows.map((row) => [printable(row.item), utc(row.added_at)]),
    ),
  ].join("\n");
}

function query(sqls, local) {
  const target = local ? ["--local"] : ["--remote", "-c", PRODUCTION_CONFIG];
  const env = local
    ? process.env
    : { ...process.env, CLOUDFLARE_ACCOUNT_ID: writeProductionConfig().accountId };
  let stdout;
  try {
    stdout = execFileSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        DATABASE,
        ...target,
        "--json",
        "--command",
        sqls.join("; "),
      ],
      { cwd: web, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    throw new Error(`wrangler d1 execute failed${output ? `:\n${output}` : ""}`);
  }
  const parsed = JSON.parse(stdout.slice(stdout.search(/[[{]/)));
  if (!Array.isArray(parsed)) throw new Error(`wrangler: ${parsed?.error?.text ?? stdout}`);
  return parsed.map((statement) => statement.results ?? []);
}

export function report(options, results, context) {
  if (options.action === "list") {
    const listsOff = results[1]?.[0]?.value === "off";
    return formatRulings(results[0] ?? [], { ...options, ...context, listsOff });
  }
  if (options.action === "blocklist") return formatBlocklist(results[0] ?? [], context);
  if (options.action === "lists") return formatSwitch(options, results, context);
  if (options.action === "prune") return formatPrune(options, results, context);
  return formatChange(options, results, context);
}

function main() {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`recent: ${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (options.action === "help") {
    console.log(USAGE);
    return;
  }
  const context = {
    questionSet: QUESTION_SET_VERSION,
    source: options.local ? "local D1" : "production D1",
  };
  const results = query(statements(options, { now: Date.now() }), options.local);
  if (options.action === "prune" && options.yes) {
    const deletes = pruneStatements(results[0] ?? []);
    if (deletes.length > 0) query(deletes, options.local);
  }
  console.log(report(options, results, context));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`recent: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

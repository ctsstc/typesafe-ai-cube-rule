#!/usr/bin/env node
// Owner-only: seeds the docket from the eval's rulings and backfills foods asked under older
// question sets. See docs/deploy.md#seeding-and-backfill. Runs under tsx (see the root package.json)
// because it imports TypeScript source.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { MIN_ASKS, recordRuling } from "../apps/web/functions/_lib/rulings.ts";
import { parseRaw, requestFingerprint } from "../eval/src/cache.ts";
import { loadDataset } from "../eval/src/dataset.ts";
import {
  buildCubeRequest,
  CATEGORY_IDS,
  CUBE_MODEL,
  isClassifyResponse,
  normalizeItem,
  precheckItem,
  publicListing,
  QUESTION_SET_VERSION,
  toCubeResult,
} from "../packages/core/src/index.ts";
import { loadSettings, PRODUCTION_CONFIG, writeProductionConfig } from "./cloudflare-config.mjs";
import { sqlString } from "./recent.mjs";
import {
  averageInputTokens,
  DEFAULT_DAILY_CALL_LIMIT,
  FALLBACK_TOKENS_PER_CALL,
  parseDailyCallLimit,
  USD_PER_MILLION_INPUT_TOKENS,
  utcDay,
} from "./spend.mjs";

const DATABASE = "cube-rule-oracle";
// pages-dev.sh binds --kv CLASSIFICATIONS, which wrangler stores under that name as the namespace id.
const LOCAL_KV_NAMESPACE = "CLASSIFICATIONS";
// The Function pins the same host, so a stray TYPESAFE_BASE_URL can never send the key elsewhere.
const TYPESAFE_BASE_URL = "https://api.typesafe.ai";
// Free plan KV allows 1,000 writes a day; each Jev call today may already have spent one.
export const KV_WRITE_CEILING = 900;
const KV_WRITES_PER_DAY = 1000;
export const DEFAULT_MAX_USD = 0.05;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const LOOKUP_CHUNK = 200;

const root = fileURLToPath(new URL("..", import.meta.url));
const web = `${root}apps/web`;

export const USAGE = `Usage:
  pnpm seed:docket [--backfill [--max-usd <n>]] [--apply] [--local [--persist-to <dir>]]

Seeds the rulings table and KV with the eval rulings of the current question set that pass
the listing gates, skipping any already recorded. A dry run by default: it reads D1 and lists
KV keys, prints the plan and writes nothing. --apply writes.

--backfill     also re-asks Jev for foods stored under older question sets in KV and records
               them the way the Function records a Jev call. Costs about $0.0004 a food.
--max-usd <n>  refuse a backfill estimated above n dollars (default ${DEFAULT_MAX_USD}).
--local        use the local D1 and KV from pnpm dev instead of production.
--persist-to   the local state directory, as wrangler's --persist-to (with --local only).`;

export class UsageError extends Error {}

export function parseOptions(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        apply: { type: "boolean" },
        backfill: { type: "boolean" },
        "max-usd": { type: "string" },
        local: { type: "boolean" },
        "persist-to": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (values.help) return { help: true };
  const backfill = values.backfill ?? false;
  const local = values.local ?? false;
  if (values["max-usd"] !== undefined && !backfill) {
    throw new UsageError("--max-usd only applies to --backfill.");
  }
  const maxUsd = values["max-usd"] === undefined ? DEFAULT_MAX_USD : Number(values["max-usd"]);
  if (!Number.isFinite(maxUsd) || maxUsd < 0) {
    throw new UsageError("--max-usd takes a dollar amount, such as 0.05.");
  }
  const persistTo = values["persist-to"];
  if (persistTo !== undefined && !local) throw new UsageError("--persist-to needs --local.");
  if (persistTo !== undefined && persistTo.trim() === "") {
    throw new UsageError("--persist-to needs a directory.");
  }
  return {
    help: false,
    apply: values.apply ?? false,
    backfill,
    maxUsd,
    local,
    persistTo: persistTo ?? null,
  };
}

const canonical = (item) => item === normalizeItem(item) && !precheckItem(item);

const count = (tally, reason) => tally.set(reason, (tally.get(reason) ?? 0) + 1);

const FOOD_LABELS = new Set(CATEGORY_IDS);

/**
 * Encoded abusive probes are never seeded, whatever the gates say, and neither are the person
 * probes that are not foods ("my family", "taylor swift"): they test the person gate, nobody asked
 * for them. Foods named after people ("eggs benedict") stay. `firstSeen` is in ms.
 */
export function seedEntries(records, dataset, { questionSet, model, fingerprint }) {
  const byKey = new Map(dataset.map((entry) => [entry.key, entry]));
  const skipped = new Map();
  const entries = new Map();
  for (const record of records) {
    const known = byKey.get(record.item);
    const response = { model: record.model, answers: record.answers };
    let reason = null;
    if (record.model !== model) reason = "other model";
    else if (record.version !== questionSet || record.fingerprint !== fingerprint) {
      reason = "stale request";
    } else if (!known) reason = "not in the dataset";
    else if (known.encoded) reason = "abusive probe";
    else if (known.person !== undefined && !FOOD_LABELS.has(known.expected))
      reason = "person probe";
    else if (!isClassifyResponse(response)) reason = "malformed";
    else if (!canonical(known.item)) reason = "not canonical";
    if (reason) {
      count(skipped, reason);
      continue;
    }
    const listing = publicListing(known.item, response);
    const firstSeen = Date.parse(record.fetchedAt);
    if (!listing.listed) count(skipped, listing.reason);
    else if (!Number.isFinite(firstSeen)) count(skipped, "no fetch time");
    else if (entries.has(known.item)) count(skipped, "duplicate");
    else entries.set(known.item, { item: known.item, response, firstSeen });
  }
  return { entries: [...entries.values()], skipped };
}

export function kvItems(keys, questionSet) {
  const current = new Set();
  const earlier = new Set();
  let notCanonical = 0;
  for (const key of keys) {
    const match = /^v(\d+):(.*)$/s.exec(key);
    if (!match) continue;
    const [, version, item] = match;
    if (version === questionSet) {
      current.add(item);
    } else if (Number(version) < Number(questionSet)) {
      if (!canonical(item)) notCanonical += 1;
      else earlier.add(item);
    }
  }
  return { current, earlier, notCanonical };
}

const utcMinute = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function startOfUtcDay(now) {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

export function plan({
  entries,
  kv,
  recorded,
  usageCalls,
  backfill,
  now,
  maxUsd = DEFAULT_MAX_USD,
  tokensPerCall = FALLBACK_TOKENS_PER_CALL,
  rowsPerRuling,
  dailyCallLimit = DEFAULT_DAILY_CALL_LIMIT,
}) {
  const seedRows = entries.filter((entry) => !recorded.has(entry.item));
  const seedKv = entries.filter((entry) => !kv.current.has(entry.item));
  const seeded = new Set(entries.map((entry) => entry.item));
  const asked = backfill ? [...kv.earlier] : [];
  const backfillItems = asked.filter((item) => !recorded.has(item) && !seeded.has(item));
  const usd = (backfillItems.length * tokensPerCall * USD_PER_MILLION_INPUT_TOKENS) / 1e6;
  const kvWrites = seedKv.length + backfillItems.length;
  const kvLimit = KV_WRITE_CEILING - usageCalls;
  const rulings = seedRows.length + backfillItems.length;
  const d1Rows = rulings * rowsPerRuling + (backfillItems.length > 0 ? 2 : 0);
  // Backfill calls count toward DAILY_CALL_LIMIT like the Function's; the seed's KV writes do not.
  const worstCase = seedKv.length + Math.max(dailyCallLimit, usageCalls + backfillItems.length);
  const kvOverrun =
    worstCase > KV_WRITES_PER_DAY ? { oneOff: seedKv.length, dailyCallLimit, worstCase } : null;

  const refusals = [];
  if (kvWrites > 0 && kvWrites > kvLimit) {
    refusals.push(
      `${kvWrites} KV writes would pass today's margin of ${Math.max(0, kvLimit)} (${KV_WRITE_CEILING} minus ${usageCalls} Jev calls so far today). Run it after 00:00 UTC.`,
    );
  }
  // A first_seen inside the last hour would count toward the "new foods in the last hour" line.
  const recent = seedRows.filter((entry) => entry.firstSeen > now - HOUR_MS);
  if (recent.length > 0) {
    const safe = Math.max(...recent.map((entry) => entry.firstSeen)) + HOUR_MS;
    refusals.push(
      `${recent.length} eval rulings were fetched less than an hour ago and would show up as new foods. Run it after ${utcMinute(Math.ceil(safe / 60_000) * 60_000)}.`,
    );
  }
  const dayStart = startOfUtcDay(now);
  if (backfillItems.length > 0 && now - dayStart < HOUR_MS) {
    refusals.push(
      "Backfilled foods are first seen at 00:00 UTC, which is still inside the last hour. Run the backfill after 01:00 UTC.",
    );
  }
  if (usd > maxUsd) {
    refusals.push(
      `${backfillItems.length} Jev calls would cost about $${usd.toFixed(4)}, over --max-usd ${maxUsd}.`,
    );
  }
  return {
    seedRows,
    seedKv,
    backfill: {
      enabled: backfill,
      items: backfillItems,
      asked: asked.length,
      recorded: asked.filter((item) => recorded.has(item)).length,
      seeded: asked.filter((item) => !recorded.has(item) && seeded.has(item)).length,
      notCanonical: kv.notCanonical,
      firstSeen: dayStart,
      usd,
      tokensPerCall,
    },
    kvWrites,
    kvLimit,
    kvOverrun,
    usageCalls,
    d1Rows,
    rowsPerRuling,
    refusals,
  };
}

function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`cannot write ${value} to D1`);
    return String(value);
  }
  if (typeof value === "string") return sqlString(value);
  throw new Error(`cannot write a ${typeof value} to D1`);
}

/** Inlines ?N parameters in one pass, so a bound value is never scanned for placeholders. */
export function inlineSql(sql, params) {
  return sql.replace(/\?(\d+)/g, (_, index) => {
    const n = Number(index);
    if (n < 1 || n > params.length) throw new Error(`no value for ?${index}`);
    return literal(params[n - 1]);
  });
}

// Stands in for env.DB, so each ruling is written by the Function's own recordRuling.
function capturingDb(statements) {
  const statement = (sql, params) => ({
    bind: (...values) => statement(sql, values),
    run: async () => {
      statements.push(inlineSql(sql, params));
      return { success: true, results: [], meta: {} };
    },
  });
  return { prepare: (sql) => statement(sql, []) };
}

/** SQL for `rows` ({item, response, at}), recorded as the Function records a Jev call at `at`. */
export async function rulingStatements(rows) {
  const statements = [];
  const env = { DB: capturingDb(statements) };
  for (const { item, response, at } of rows) await recordRuling(env, item, response, at);
  return statements;
}

export function usageStatements(calls) {
  const days = new Map();
  for (const { day, tokens } of calls) {
    const total = days.get(day) ?? { calls: 0, tokens: 0, tokenCalls: 0 };
    total.calls += 1;
    if (tokens > 0) {
      total.tokens += tokens;
      total.tokenCalls += 1;
    }
    days.set(day, total);
  }
  return [...days].map(
    ([day, total]) =>
      `INSERT INTO usage (day, calls, input_tokens, token_calls) VALUES (${sqlString(day)}, ${total.calls}, ${total.tokens}, ${total.tokenCalls}) ON CONFLICT (day) DO UPDATE SET calls = calls + excluded.calls, input_tokens = input_tokens + excluded.input_tokens, token_calls = token_calls + excluded.token_calls`,
  );
}

export function kvPairs(rows, questionSet) {
  return rows.map(({ item, response }) => ({
    key: `v${questionSet}:${item}`,
    value: JSON.stringify({ model: response.model, answers: response.answers }),
  }));
}

export const lookupStatements = (items, questionSet) => {
  const statements = [];
  for (let start = 0; start < items.length; start += LOOKUP_CHUNK) {
    const chunk = items.slice(start, start + LOOKUP_CHUNK).map(sqlString);
    statements.push(
      `SELECT item FROM rulings WHERE question_set = ${sqlString(questionSet)} AND item IN (${chunk.join(", ")})`,
    );
  }
  return statements;
};

export const usageStatement = (now) =>
  `SELECT calls FROM usage WHERE day = ${sqlString(utcDay(now))}`;

class UnexpectedResponseShape extends Error {
  name = "UnexpectedResponseShape";
}

function inputTokens(result) {
  const tokens = result?.usage?.input_tokens;
  return typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens > 0 ? tokens : 0;
}

function describe(error) {
  if (!(error instanceof Error)) return typeof error;
  return "status" in error ? `${error.name} ${error.status}` : error.name;
}

/** A failed call still counts toward spend and usage, since it may be billed. */
export async function askJev(items, { client, maxUsd, tokensPerCall, clock = Date.now }) {
  const guess = (tokensPerCall * USD_PER_MILLION_INPUT_TOKENS) / 1e6;
  const answered = [];
  const failures = [];
  const calls = [];
  let spent = 0;
  let skipped = 0;
  for (const [index, item] of items.entries()) {
    if (spent + guess > maxUsd) {
      skipped = items.length - index;
      break;
    }
    const at = clock();
    let tokens = 0;
    try {
      const result = await client.systemOne(buildCubeRequest(item));
      tokens = inputTokens(result);
      if (!isClassifyResponse(result)) throw new UnexpectedResponseShape();
      answered.push({ item, response: { model: result.model, answers: result.answers } });
    } catch (error) {
      failures.push(describe(error));
    }
    calls.push({ day: utcDay(at), tokens });
    spent += tokens > 0 ? (tokens * USD_PER_MILLION_INPUT_TOKENS) / 1e6 : guess;
  }
  return { answered, failures, calls, spent, skipped };
}

const number = (n) => n.toLocaleString("en-US");
const plural = (n, one, many = `${one}s`) => `${number(n)} ${n === 1 ? one : many}`;

export function formatPlan(
  result,
  { source, questionSet, apply, total, seedable, skipped, kvKeys, lookups },
) {
  const { backfill } = result;
  const reasons = [...skipped]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} ${reason}`)
    .join(", ");
  const honorary = result.seedRows.filter(
    (entry) => toCubeResult(entry.item, entry.response).kind === "honorary",
  ).length;
  const lines = [
    `${apply ? "Seeding" : "Dry run: seeding"} the docket for question set ${questionSet} in the ${source}.`,
    "",
    `Eval rulings: ${number(total)} in eval/results/v${questionSet}/raw.jsonl, ${number(seedable)} listable${reasons ? ` (left out: ${reasons})` : ""}.`,
    `  D1: ${plural(result.seedRows.length, "new ruling")} (${number(honorary)} honorary), ${number(seedable - result.seedRows.length)} already recorded. First seen at each eval fetch time, asks 1.`,
    `  KV: ${plural(result.seedKv.length, "new ruling")}, ${number(seedable - result.seedKv.length)} already stored under v${questionSet}.`,
  ];
  if (backfill.enabled) {
    lines.push(
      "",
      `Backfill: ${plural(backfill.asked, "food")} stored under older question sets in KV${backfill.notCanonical > 0 ? ` (${number(backfill.notCanonical)} more ${backfill.notCanonical === 1 ? "is" : "are"} not canonical and skipped)` : ""}.`,
      `  ${number(backfill.recorded)} already recorded for question set ${questionSet}, ${number(backfill.seeded)} covered by the seed.`,
      `  Jev: ${plural(backfill.items.length, "call")}, about $${backfill.usd.toFixed(4)} at ${number(Math.round(backfill.tokensPerCall))} input tokens a call.`,
      `  D1 and KV: one ruling each per answer, listed or not, first seen ${utcMinute(backfill.firstSeen)}, and the calls added to today's usage row.`,
    );
  }
  lines.push(
    "",
    "Writes:",
    `  D1: at most ${number(result.d1Rows)} rows, counting index rows (${number(result.rowsPerRuling)} a ruling at most), of 100,000 a day.`,
    `  KV: ${number(result.kvWrites)} writes. Today's margin is ${number(Math.max(0, result.kvLimit))}: ${KV_WRITE_CEILING} minus ${plural(result.usageCalls, "Jev call")} so far today.`,
    `Read to plan this: ${plural(kvKeys, "KV key")} (1 list operation per 1,000 keys), ${plural(lookups, "D1 lookup")} and today's usage row.`,
  );
  const overrun = result.kvOverrun;
  if (overrun) {
    const safeLimit = KV_WRITES_PER_DAY - overrun.oneOff;
    const lower =
      safeLimit >= result.usageCalls + backfill.items.length
        ? `, or deploy DAILY_CALL_LIMIT ${safeLimit} until 00:00 UTC`
        : "";
    lines.push(
      "",
      `The ${number(overrun.oneOff)} seed KV writes do not count toward DAILY_CALL_LIMIT (${number(overrun.dailyCallLimit)}), so if Jev calls reach it today, KV passes ${number(KV_WRITES_PER_DAY)} writes (${number(overrun.worstCase)}) and later rulings go unstored. Run the seed late in the UTC day${lower}.`,
    );
  }
  if (result.refusals.length > 0) {
    lines.push("", "Refused:", ...result.refusals.map((reason) => `  ${reason}`));
  } else if (!apply) {
    lines.push("", "Nothing was written. Run it again with --apply to write.");
  }
  return lines.join("\n");
}

function redact(text) {
  const { settings } = loadSettings();
  let clean = text;
  for (const secret of Object.values(settings)) clean = clean.replaceAll(secret, "<redacted>");
  return clean;
}

function wrangler(args, { local, persistTo }) {
  const target = local
    ? ["--local", ...(persistTo ? ["--persist-to", persistTo] : [])]
    : ["--remote", "-c", PRODUCTION_CONFIG];
  const env = local
    ? process.env
    : { ...process.env, CLOUDFLARE_ACCOUNT_ID: writeProductionConfig().accountId };
  try {
    return execFileSync("pnpm", ["exec", "wrangler", ...args, ...target], {
      cwd: web,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const output = redact(`${error.stdout ?? ""}${error.stderr ?? ""}`.trim());
    throw new Error(`wrangler ${args.slice(0, 3).join(" ")} failed${output ? `:\n${output}` : ""}`);
  }
}

const json = (stdout) => JSON.parse(stdout.slice(stdout.search(/[[{]/)));

function namespace(options) {
  if (options.local) return LOCAL_KV_NAMESPACE;
  const id = loadSettings().settings.CLOUDFLARE_KV_CLASSIFICATIONS_ID;
  if (!id) throw new Error("set CLOUDFLARE_KV_CLASSIFICATIONS_ID in the root .env.");
  return id;
}

function listKvKeys(options) {
  const keys = json(wrangler(["kv", "key", "list", "--namespace-id", namespace(options)], options));
  if (!Array.isArray(keys)) throw new Error("wrangler kv key list did not return a list");
  return keys.map((key) => String(key.name));
}

function d1(sqls, options) {
  const parsed = json(
    wrangler(["d1", "execute", DATABASE, "--json", "--command", sqls.join("; ")], options),
  );
  if (!Array.isArray(parsed)) throw new Error(`wrangler: ${parsed?.error?.text ?? "no results"}`);
  return parsed.map((statement) => statement.results ?? []);
}

const finite = (n) => typeof n === "number" && Number.isFinite(n);

/** Rows written as D1 reports them. Remote imports report them, local runs leave them out. */
export function rowsWritten(stdout) {
  let parsed;
  try {
    parsed = json(stdout);
  } catch {
    return null;
  }
  const counts = (Array.isArray(parsed) ? parsed : [parsed]).map((result) => {
    const summary = Array.isArray(result?.results) ? result.results[0]?.["Rows written"] : null;
    return finite(summary) ? summary : result?.meta?.rows_written;
  });
  const numbers = counts.filter(finite);
  return numbers.length === 0 ? null : numbers.reduce((sum, n) => sum + n, 0);
}

// node:sqlite prints an ExperimentalWarning on first load.
async function sqlite() {
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  try {
    return await import("node:sqlite");
  } finally {
    process.emitWarning = emit;
  }
}

/**
 * The most rows one new ruling writes: the table row plus each index on rulings, leaving out
 * indexes that need more asks than a new row has.
 */
export async function rowsPerRuling() {
  const { DatabaseSync } = await sqlite();
  const migrations = `${web}/migrations/`;
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(`${migrations}${file}`, "utf8"));
  }
  const indexes = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'rulings'")
    .all()
    .map((row) => String(row.sql ?? ""));
  db.close();
  const enters = (sql) => Number(/\basks >= (\d+)/.exec(sql)?.[1] ?? 0) <= MIN_ASKS;
  return 1 + indexes.filter(enters).length;
}

function readApiKey() {
  const fromEnv = process.env.TYPESAFE_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const path = `${root}.env`;
  const dotenv = existsSync(path) ? readFileSync(path, "utf8") : "";
  const value = dotenv.match(/^TYPESAFE_API_KEY=(.*)$/m)?.[1]?.trim() ?? "";
  return value.replace(/^(["'])(.*)\1$/, "$2");
}

function typesafeClient(apiKey) {
  // The SDK is a dependency of apps/web, not of the repo root this script sits in.
  const { TypeSafeClient } = createRequire(`${web}/package.json`)("@typesafe-ai/sdk");
  return new TypeSafeClient({
    apiKey,
    baseURL: TYPESAFE_BASE_URL,
    timeout: 15_000,
    retry: { maxRetries: 0 },
    logLevel: "off",
  });
}

function evalRulings() {
  const raw = `${root}eval/results/v${QUESTION_SET_VERSION}/raw.jsonl`;
  if (!existsSync(raw))
    throw new Error(`no eval results at eval/results/v${QUESTION_SET_VERSION}.`);
  const text = readFileSync(raw, "utf8");
  return {
    records: [...parseRaw(text).values()],
    tokensPerCall: averageInputTokens(text) ?? FALLBACK_TOKENS_PER_CALL,
  };
}

// D1 goes first: if KV then fails, a rerun finds the rows recorded and only stores the KV values.
async function write(result, answered, calls, options) {
  const statements = [
    ...(await rulingStatements(
      result.seedRows.map((entry) => ({ ...entry, at: entry.firstSeen })),
    )),
    ...(await rulingStatements(
      answered.map((entry) => ({ ...entry, at: result.backfill.firstSeen })),
    )),
    ...usageStatements(calls),
  ];
  const pairs = [
    ...kvPairs(result.seedKv, QUESTION_SET_VERSION),
    ...kvPairs(answered, QUESTION_SET_VERSION),
  ];
  const summary = [];
  const dir = mkdtempSync(join(tmpdir(), "seed-docket-"));
  try {
    if (statements.length > 0) {
      const file = join(dir, "rulings.sql");
      writeFileSync(file, `${statements.join(";\n")};\n`);
      const out = wrangler(["d1", "execute", DATABASE, "--file", file, "--json", "--yes"], options);
      const written = rowsWritten(out);
      summary.push(
        `D1: ${plural(statements.length, "statement")} run${written === null ? "" : `, ${number(written)} rows written`}.`,
      );
    }
    if (pairs.length > 0) {
      const file = join(dir, "rulings.json");
      writeFileSync(file, JSON.stringify(pairs));
      try {
        wrangler(["kv", "bulk", "put", file, "--namespace-id", namespace(options)], options);
      } catch (error) {
        throw new Error(
          `${summary.join(" ")} ${error.message}\nA rerun stores the missing eval rulings in KV. Backfilled foods stay recorded without a KV value until someone asks for them again.`,
        );
      }
      summary.push(`KV: ${plural(pairs.length, "ruling")} stored.`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return summary;
}

async function main() {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`seed-docket: ${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (options.persistTo && !isAbsolute(options.persistTo)) {
    options.persistTo = resolve(process.env.INIT_CWD ?? process.cwd(), options.persistTo);
  }
  const questionSet = QUESTION_SET_VERSION;
  const source = options.local ? "local D1 and KV" : "production D1 and KV";
  const { records, tokensPerCall } = evalRulings();
  const { entries, skipped } = seedEntries(records, loadDataset(), {
    questionSet,
    model: CUBE_MODEL,
    fingerprint: requestFingerprint(),
  });

  const keys = listKvKeys(options);
  const kv = kvItems(keys, questionSet);
  const now = Date.now();
  const candidates = [
    ...new Set([...entries.map((entry) => entry.item), ...(options.backfill ? kv.earlier : [])]),
  ];
  const lookups = lookupStatements(candidates, questionSet);
  const results = d1([...lookups, usageStatement(now)], options);
  const recorded = new Set(
    results.slice(0, lookups.length).flatMap((rows) => rows.map((row) => row.item)),
  );
  const usageCalls = Number(results.at(-1)?.[0]?.calls ?? 0);

  const result = plan({
    entries,
    kv,
    recorded,
    usageCalls,
    backfill: options.backfill,
    now,
    maxUsd: options.maxUsd,
    tokensPerCall,
    rowsPerRuling: await rowsPerRuling(),
    dailyCallLimit: parseDailyCallLimit(readFileSync(`${web}/wrangler.jsonc`, "utf8")),
  });
  console.log(
    formatPlan(result, {
      source,
      questionSet,
      apply: options.apply,
      total: records.length,
      seedable: entries.length,
      skipped,
      kvKeys: keys.length,
      lookups: lookups.length,
    }),
  );
  if (MIN_ASKS > 1) {
    console.log(
      `\nMIN_ASKS is ${MIN_ASKS}, so seeded rulings wait for ${MIN_ASKS - 1} more ask each before they are listed.`,
    );
  }
  if (result.refusals.length > 0) process.exit(1);
  if (!options.apply) return;
  if (result.kvWrites === 0 && result.seedRows.length === 0) {
    console.log("\nNothing to write.");
    return;
  }

  let answered = [];
  let calls = [];
  if (result.backfill.items.length > 0) {
    const apiKey = readApiKey();
    if (!apiKey) throw new Error("the backfill needs TYPESAFE_API_KEY in the root .env.");
    const asked = await askJev(result.backfill.items, {
      client: typesafeClient(apiKey),
      maxUsd: options.maxUsd,
      tokensPerCall,
    });
    ({ answered, calls } = asked);
    console.log(
      `\nJev answered ${number(answered.length)} of ${plural(asked.calls.length, "call")}, about $${asked.spent.toFixed(4)}.${asked.failures.length > 0 ? ` Failed: ${asked.failures.join(", ")}. Run it again to retry them.` : ""}${asked.skipped > 0 ? ` Stopped ${plural(asked.skipped, "food")} short of --max-usd.` : ""}`,
    );
  }
  const summary = await write(result, answered, calls, options);
  console.log(`\n${summary.join("\n")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`seed-docket: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}

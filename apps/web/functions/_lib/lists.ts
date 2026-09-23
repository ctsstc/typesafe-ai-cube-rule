import {
  disabledListsResponse,
  hasPersonalInfo,
  isListEntry,
  isListsQuery,
  LIST_NAMES,
  LISTS_ACTIVITY_CAP,
  type ListEntry,
  type ListName,
  type ListsResponse,
  listingBar,
  listsUrl,
  QUESTION_SET_VERSION,
  THRESHOLDS,
} from "@cube/core";
import type { Env, WaitUntil } from "./env";
import { CACHE_NONE, type CacheStatus, errorResponse, jsonResponse } from "./http";
import { MIN_ASKS } from "./rulings";

export const LISTS_TTL_S = 120;
export const LIST_LENGTH = 8;
export const DEFAULT_ACTIVITY_THRESHOLD = 5;
// Bounds the rows each refresh reads in a busy hour (docs/deploy.md#d1-budget).
export const ACTIVITY_CAP = LISTS_ACTIVITY_CAP;
const HOUR_S = 3600;
const CACHE_LISTS = `public, max-age=${LISTS_TTL_S}`;

const COLUMNS = `item, kind, category, wet, confidence, runner_up, official, debate_level,
  person_none, person_public, person_private, abusive`;
// Must match migration 0008's partial index predicates word for word, literals included.
const PUBLIC = `listed = 1 AND asks >= ${MIN_ASKS}`;
const NOT_BLOCKED = "NOT EXISTS (SELECT 1 FROM blocklist WHERE blocklist.item = rulings.item)";

const list = (index: string, where: string, order: string) =>
  `SELECT ${COLUMNS} FROM rulings INDEXED BY ${index}
WHERE question_set = ?1 AND ${PUBLIC}${where} AND ${NOT_BLOCKED}
ORDER BY ${order} LIMIT ${LIST_LENGTH}`;

export const LIST_QUERIES: Readonly<Record<ListName, string>> = {
  latest: list("rulings_latest", "", "first_seen DESC"),
  mostDebated: list(
    "rulings_debated",
    ` AND confidence < ${THRESHOLDS.unanimous}`,
    "confidence ASC",
  ),
  honoraryCourt: list("rulings_honorary", " AND kind = 'honorary'", "confidence DESC"),
  friendshipEnding: list(
    "rulings_heat",
    " AND debate_level > 0",
    "debate_level DESC, first_seen DESC",
  ),
};

// Counts only rulings that passed the listing gates, so declined text never adds to "new foods".
export const ACTIVITY_QUERY = `SELECT first_seen FROM rulings INDEXED BY rulings_activity
WHERE question_set = ?1 AND listed = 1 AND first_seen >= ?2 LIMIT ?3`;

export const SWITCH_QUERY = "SELECT value FROM switches WHERE name = 'lists'";

export function listsEnabled(env: Env): boolean {
  const value = env.PUBLIC_LISTS?.trim().toLowerCase();
  return !value || value === "on";
}

// The count never exceeds ACTIVITY_CAP, so a higher threshold would hide the line for good.
export function activityThreshold(env: Env): number {
  const threshold = Number(env.ACTIVITY_THRESHOLD?.trim() || Number.NaN);
  if (!Number.isSafeInteger(threshold) || threshold < 1) return DEFAULT_ACTIVITY_THRESHOLD;
  return Math.min(threshold, ACTIVITY_CAP);
}

function isStaleListsQuery(rawSearch: string): boolean {
  const version = /^\??v=(\d{1,4})$/.exec(rawSearch)?.[1];
  return version !== undefined && version !== QUESTION_SET_VERSION;
}

interface RulingRow {
  item: unknown;
  kind: unknown;
  category: unknown;
  wet: unknown;
  confidence: unknown;
  runner_up: unknown;
  official: unknown;
  debate_level: unknown;
  person_none: number | null;
  person_public: number | null;
  person_private: number | null;
  abusive: number | null;
}

function toEntry(row: RulingRow): ListEntry | null {
  const entry = {
    item: row.item,
    kind: row.kind,
    category: row.category,
    wet: row.wet === 1,
    confidence: row.confidence,
    runnerUp: row.runner_up ?? null,
    official: row.official ?? null,
    debateLevel: row.debate_level,
  };
  if (!isListEntry(entry) || hasPersonalInfo(entry.item)) return null;
  const scores = {
    personNone: row.person_none,
    personPublic: row.person_public,
    personPrivate: row.person_private,
    abusive: row.abusive,
  };
  return listingBar(entry.item, scores) === null ? entry : null;
}

export async function readLists(db: D1Database, env: Env, now: number): Promise<ListsResponse> {
  const since = Math.floor(now / 1000) - HOUR_S;
  const results = await db.batch([
    db.prepare(SWITCH_QUERY),
    ...LIST_NAMES.map((name) => db.prepare(LIST_QUERIES[name]).bind(QUESTION_SET_VERSION)),
    db.prepare(ACTIVITY_QUERY).bind(QUESTION_SET_VERSION, since, ACTIVITY_CAP),
  ]);
  const [switched] = (results[0]?.results ?? []) as { value?: unknown }[];
  if (
    String(switched?.value ?? "")
      .trim()
      .toLowerCase() === "off"
  )
    return disabledListsResponse();
  const rows = (index: number) => (results[index + 1]?.results ?? []) as RulingRow[];
  const lists = Object.fromEntries(
    LIST_NAMES.map((name, index) => [
      name,
      rows(index)
        .map(toEntry)
        .filter((entry) => entry !== null),
    ]),
  ) as Record<ListName, ListEntry[]>;
  const newFoodsLastHour = rows(LIST_NAMES.length).length;
  return {
    enabled: true,
    questionSetVersion: QUESTION_SET_VERSION,
    activity: newFoodsLastHour >= activityThreshold(env) ? { newFoodsLastHour } : null,
    lists,
  };
}

let reportedNoDb = false;

export async function handleLists(
  request: Request,
  env: Env,
  waitUntil: WaitUntil,
): Promise<Response> {
  try {
    return await lists(request, env, waitUntil);
  } catch (error) {
    console.error("lists: unhandled error", describe(error));
    return listsResponse(disabledListsResponse(), CACHE_NONE);
  }
}

async function lists(request: Request, env: Env, waitUntil: WaitUntil): Promise<Response> {
  if (request.method !== "GET") {
    return errorResponse("method_not_allowed", { headers: { Allow: "GET" } });
  }
  const url = new URL(request.url);
  if (!isListsQuery(url.search)) {
    if (isStaleListsQuery(url.search)) return errorResponse("stale_client");
    return errorResponse("bad_request", { message: "That is not a canonical lists request." });
  }
  if (!listsEnabled(env)) return listsResponse(disabledListsResponse(), CACHE_LISTS);

  const db = env.DB;
  if (!db) {
    if (!reportedNoDb) {
      reportedNoDb = true;
      console.warn("lists: no DB binding, so the public lists are off");
    }
    return listsResponse(disabledListsResponse(), CACHE_NONE);
  }

  const cache = typeof caches === "undefined" ? undefined : caches.default;
  const cacheKey = new Request(new URL(listsUrl(), url.origin));
  try {
    const cached = await cache?.match(cacheKey);
    if (cached) return cached;
  } catch (error) {
    console.warn("lists: cache read failed", describe(error));
  }

  let body: string;
  try {
    body = JSON.stringify(await readLists(db, env, Date.now()));
  } catch (error) {
    console.error("lists: read failed", describe(error));
    return listsResponse(disabledListsResponse(), CACHE_NONE);
  }
  const put = cache?.put(cacheKey, listsBody(body, CACHE_LISTS, "HIT"));
  if (put) {
    waitUntil(put.catch((error) => console.warn("lists: cache put failed", describe(error))));
  }
  return listsBody(body, CACHE_LISTS, "MISS");
}

function listsResponse(response: ListsResponse, cacheControl: string): Response {
  return listsBody(JSON.stringify(response), cacheControl);
}

function listsBody(body: string, cacheControl: string, cache?: CacheStatus): Response {
  return jsonResponse(body, { cacheControl, cache });
}

function describe(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.name : typeof error };
}

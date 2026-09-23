import {
  type CubeResponse,
  isClassifyResponse,
  listingScores,
  publicListing,
  QUESTION_SET_VERSION,
  toCubeResult,
  toListEntry,
} from "@cube/core";
import type { Env } from "./env";

// Migration 0006's partial indexes repeat it as a literal, so changing it needs a new migration.
export const MIN_ASKS = 2;

const INSERT = `INSERT INTO rulings (question_set, item, kind, category, wet, confidence, runner_up,
  official, debate_level, person_none, person_public, person_private, abusive, listed, reason, asks,
  first_seen)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 1, ?16)`;

// Both upserts stop at MIN_ASKS, so a public row costs no writes however often it is asked for.
const RECORD_RULING = `${INSERT}
ON CONFLICT (question_set, item) DO UPDATE SET kind = excluded.kind,
  category = excluded.category, wet = excluded.wet, confidence = excluded.confidence,
  runner_up = excluded.runner_up, official = excluded.official,
  debate_level = excluded.debate_level, person_none = excluded.person_none,
  person_public = excluded.person_public, person_private = excluded.person_private,
  abusive = excluded.abusive, listed = excluded.listed, reason = excluded.reason,
  asks = rulings.asks + 1
WHERE rulings.asks < ?17`;

// Sets only asks on a conflict, which leaves rulings_first_seen and rulings_activity untouched.
const COUNT_ASK = `${INSERT}
ON CONFLICT (question_set, item) DO UPDATE SET asks = rulings.asks + 1
WHERE rulings.asks < ?17`;

function row(item: string, response: CubeResponse, now: number) {
  const { listed, reason } = publicListing(item, response);
  const result = toCubeResult(item, response);
  const entry = toListEntry(item, result);
  const scores = listingScores(response);
  return [
    QUESTION_SET_VERSION,
    item,
    result.kind,
    entry?.category ?? null,
    entry?.wet ? 1 : 0,
    entry?.confidence ?? null,
    entry?.runnerUp ?? null,
    entry?.official ?? null,
    entry?.debateLevel ?? 0,
    scores.personNone,
    scores.personPublic,
    scores.personPrivate,
    scores.abusive,
    listed ? 1 : 0,
    reason,
    Math.floor(now / 1000),
    MIN_ASKS,
  ];
}

/** Only after a Jev call: DAILY_CALL_LIMIT is what bounds its writes. */
export async function recordRuling(
  env: Env,
  item: string,
  response: CubeResponse,
  now: number,
): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(RECORD_RULING)
    .bind(...row(item, response, now))
    .run();
}

/**
 * One more ask for a ruling served from the edge cache or KV. `stored` is that ruling's body, so a
 * ruling whose record failed after its Jev call still gets a row.
 */
export async function countAsk(env: Env, item: string, stored: string, now: number): Promise<void> {
  if (!env.DB) return;
  const response: unknown = JSON.parse(stored);
  if (!isClassifyResponse(response)) throw new Error("stored ruling has an unexpected shape");
  await env.DB.prepare(COUNT_ASK)
    .bind(...row(item, response, now))
    .run();
}

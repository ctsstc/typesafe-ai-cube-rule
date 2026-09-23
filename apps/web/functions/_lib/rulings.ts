import {
  type CubeResponse,
  publicListing,
  QUESTION_SET_VERSION,
  toCubeResult,
  toListEntry,
} from "@cube/core";
import type { Env } from "./env";

// Migration 0006's partial indexes repeat it as a literal, so changing it needs a new migration.
export const MIN_ASKS = 2;

const FIND_BLOCKED = "SELECT 1 AS blocked FROM blocklist WHERE item = ?1";

const RECORD_RULING = `INSERT INTO rulings (question_set, item, kind, category, wet, confidence,
  runner_up, official, debate_level, listed, reason, asks, first_seen)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12)
ON CONFLICT (question_set, item) DO UPDATE SET kind = excluded.kind,
  category = excluded.category, wet = excluded.wet, confidence = excluded.confidence,
  runner_up = excluded.runner_up, official = excluded.official,
  debate_level = excluded.debate_level, listed = excluded.listed, reason = excluded.reason,
  asks = MIN(asks + 1, ?13)`;

// The asks bound is what stops a popular item from writing on every hit.
const COUNT_ASK = `UPDATE rulings SET asks = asks + 1
WHERE question_set = ?1 AND item = ?2 AND asks < ?3`;

/** Only after a Jev call: DAILY_CALL_LIMIT is what bounds its writes. */
export async function recordRuling(
  env: Env,
  item: string,
  response: CubeResponse,
  now: number,
): Promise<void> {
  const db = env.DB;
  if (!db) return;
  const blocked = await db.prepare(FIND_BLOCKED).bind(item).first();
  const { listed, reason } = publicListing(item, response, {
    blocklist: new Set(blocked ? [item] : []),
  });
  const result = toCubeResult(item, response);
  const entry = toListEntry(item, result);
  await db
    .prepare(RECORD_RULING)
    .bind(
      QUESTION_SET_VERSION,
      item,
      result.kind,
      entry?.category ?? null,
      entry?.wet ? 1 : 0,
      entry?.confidence ?? null,
      entry?.runnerUp ?? null,
      entry?.official ?? null,
      entry?.debateLevel ?? 0,
      listed ? 1 : 0,
      reason,
      Math.floor(now / 1000),
      MIN_ASKS,
    )
    .run();
}

export async function countAsk(env: Env, item: string): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(COUNT_ASK).bind(QUESTION_SET_VERSION, item, MIN_ASKS).run();
}

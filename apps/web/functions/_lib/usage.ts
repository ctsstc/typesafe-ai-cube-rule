import type { Env } from "./env";
import { errorResponse } from "./http";
import type { Session } from "./session";

export const DEFAULT_DAILY_CALL_LIMIT = 2000;
export const SESSION_CALL_LIMIT = 60;

const RESERVE_SESSION_CALL = `INSERT INTO sessions (sid, calls, exp) VALUES (?1, 1, ?3)
ON CONFLICT (sid) DO UPDATE SET calls = calls + 1 WHERE calls < ?2
RETURNING calls`;

// SQLite requires a WHERE on INSERT ... SELECT before ON CONFLICT. This one also makes a limit of 0
// refuse the day's first call.
const RESERVE_DAILY_CALL = `INSERT INTO usage (day, calls) SELECT ?1, 1 WHERE ?2 > 0
ON CONFLICT (day) DO UPDATE SET calls = calls + 1 WHERE calls < ?2
RETURNING calls`;

export function dailyCallLimit(env: Env): number {
  const limit = Number(env.DAILY_CALL_LIMIT?.trim() || Number.NaN);
  return Number.isSafeInteger(limit) && limit >= 0 ? limit : DEFAULT_DAILY_CALL_LIMIT;
}

export function secondsUntilUtcMidnight(now: number): number {
  const date = new Date(now);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now) / 1000));
}

let reportedNoDb = false;

/**
 * Counts one Jev call against the session and the UTC day, or returns the refusal.
 * The session is charged first so an exhausted session can never spend the shared daily budget.
 */
export async function reserveJevCall(
  env: Env,
  session: Session | null,
  now: number,
): Promise<Response | null> {
  const db = env.DB;
  if (!db) {
    if (!reportedNoDb) {
      reportedNoDb = true;
      console.warn("classify: no DB binding, so the daily and per-session Jev caps are off");
    }
    return null;
  }
  try {
    if (session) {
      const charged = await db
        .prepare(RESERVE_SESSION_CALL)
        .bind(session.sid, SESSION_CALL_LIMIT, session.exp)
        .first();
      if (!charged) {
        return errorResponse("challenge_required", {
          message: "This session has used its new rulings. A fresh check starts another.",
        });
      }
    }
    const day = new Date(now).toISOString().slice(0, 10);
    const limit = dailyCallLimit(env);
    const charged = await db.prepare(RESERVE_DAILY_CALL).bind(day, limit).first();
    if (!charged) {
      console.warn("classify: daily Jev call limit reached", { day, limit });
      return errorResponse("daily_limit", {
        headers: { "Retry-After": String(secondsUntilUtcMidnight(now)) },
      });
    }
    return null;
  } catch (error) {
    console.error("classify: spend check failed", {
      error: error instanceof Error ? error.name : typeof error,
    });
    return errorResponse("internal");
  }
}

export async function forgetExpiredSessions(db: D1Database, now: number): Promise<void> {
  await db
    .prepare("DELETE FROM sessions WHERE exp < ?1")
    .bind(Math.floor(now / 1000))
    .run();
}

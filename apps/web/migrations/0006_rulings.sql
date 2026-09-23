-- One row per Jev ruling, for /api/lists and pnpm recent. Declined and nonsense rows leave the list
-- fields null or 0. asks stops at MIN_ASKS (functions/_lib/rulings.ts). first_seen is unix seconds.
CREATE TABLE rulings (
  question_set TEXT NOT NULL,
  item TEXT NOT NULL,
  kind TEXT NOT NULL,
  category TEXT,
  wet INTEGER NOT NULL DEFAULT 0,
  confidence REAL,
  runner_up TEXT,
  official TEXT,
  debate_level INTEGER NOT NULL DEFAULT 0,
  listed INTEGER NOT NULL,
  reason TEXT NOT NULL,
  asks INTEGER NOT NULL,
  first_seen INTEGER NOT NULL,
  PRIMARY KEY (question_set, item)
) WITHOUT ROWID;

-- The hourly activity count and pnpm recent.
CREATE INDEX rulings_first_seen ON rulings (question_set, first_seen);

-- The lists read only public rows. Queries must repeat each predicate word for word, with the
-- literal MIN_ASKS, or SQLite cannot use these indexes and falls back to a scan.
CREATE INDEX rulings_latest ON rulings (question_set, first_seen)
  WHERE listed = 1 AND asks >= 2;
CREATE INDEX rulings_debated ON rulings (question_set, confidence)
  WHERE listed = 1 AND asks >= 2;
CREATE INDEX rulings_heat ON rulings (question_set, debate_level, first_seen)
  WHERE listed = 1 AND asks >= 2;
CREATE INDEX rulings_dissents ON rulings (question_set, confidence)
  WHERE listed = 1 AND asks >= 2 AND official <> category;

-- Normalized items that never appear in a list. Only pnpm recent --block and --unblock write here.
CREATE TABLE blocklist (
  item TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
) WITHOUT ROWID;

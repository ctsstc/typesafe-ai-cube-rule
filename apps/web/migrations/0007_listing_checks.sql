-- Jev's scores behind the person and abuse bars (listingScores in @cube/core). /api/lists checks them
-- against the current THRESHOLDS on every read, and a row without them never passes.
ALTER TABLE rulings ADD COLUMN person_none REAL;
ALTER TABLE rulings ADD COLUMN person_public REAL;
ALTER TABLE rulings ADD COLUMN person_private REAL;
ALTER TABLE rulings ADD COLUMN abusive REAL;

-- The activity count. The query must repeat the predicate word for word to use it.
CREATE INDEX rulings_activity ON rulings (question_set, first_seen) WHERE listed = 1;

-- Owner switches that work without a deploy. Only pnpm recent writes here.
CREATE TABLE switches (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  changed_at INTEGER NOT NULL
) WITHOUT ROWID;

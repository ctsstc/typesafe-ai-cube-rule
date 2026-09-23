-- Jev calls per UTC day, capped by DAILY_CALL_LIMIT.
CREATE TABLE usage (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL
);

-- Jev calls per signed session cookie, capped by SESSION_CALL_LIMIT. exp is in unix seconds.
CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  calls INTEGER NOT NULL,
  exp INTEGER NOT NULL
);

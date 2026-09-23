-- Jev calls per client per UTC day, capped by CLIENT_DAILY_CALL_LIMIT. key is an HMAC of the
-- client IP and the day under SESSION_SECRET, so no IP is stored and the key changes every day.
CREATE TABLE clients (
  key TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL
);

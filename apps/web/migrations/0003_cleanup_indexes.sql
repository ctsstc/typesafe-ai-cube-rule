-- forgetExpired deletes by these columns. Unindexed, each cleanup scans and bills every row.
CREATE INDEX sessions_exp ON sessions (exp);
CREATE INDEX clients_day ON clients (day);

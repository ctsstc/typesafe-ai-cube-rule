-- One ask lists a ruling (MIN_ASKS = 1), and Honorary court replaces Jev vs the canon. Queries must
-- repeat each predicate word for word, literals included, or SQLite cannot use these indexes.
-- Not additive: /api/lists on a deployment older than this answers enabled false until the deploy.
DROP INDEX rulings_latest;
DROP INDEX rulings_debated;
DROP INDEX rulings_heat;
DROP INDEX rulings_dissents;

CREATE INDEX rulings_latest ON rulings (question_set, first_seen)
  WHERE listed = 1 AND asks >= 1;
CREATE INDEX rulings_debated ON rulings (question_set, confidence)
  WHERE listed = 1 AND asks >= 1;
CREATE INDEX rulings_heat ON rulings (question_set, debate_level, first_seen)
  WHERE listed = 1 AND asks >= 1;
CREATE INDEX rulings_honorary ON rulings (question_set, confidence)
  WHERE listed = 1 AND asks >= 1 AND kind = 'honorary';

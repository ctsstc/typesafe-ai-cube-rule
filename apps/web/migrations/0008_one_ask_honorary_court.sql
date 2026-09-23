-- One ask lists a ruling (MIN_ASKS = 1), and Honorary court replaces Jev vs the canon. Queries must
-- repeat each predicate word for word, literals included, or SQLite cannot use these indexes.
-- Additive: the v1.2 indexes from 0006 stay, so a v1.2 deployment still reads its lists. Rows with
-- asks = 1 never enter them. Drop them only once v1.2 is no longer a rollback target.
CREATE INDEX rulings_latest1 ON rulings (question_set, first_seen)
  WHERE listed = 1 AND asks >= 1;
CREATE INDEX rulings_debated1 ON rulings (question_set, confidence)
  WHERE listed = 1 AND asks >= 1;
CREATE INDEX rulings_heat1 ON rulings (question_set, debate_level, first_seen)
  WHERE listed = 1 AND asks >= 1;
CREATE INDEX rulings_honorary ON rulings (question_set, confidence)
  WHERE listed = 1 AND asks >= 1 AND kind = 'honorary';

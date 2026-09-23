-- Calls whose input tokens were added to input_tokens, so pnpm spend can price the rest of the day's
-- calls instead of taking a partly recorded total as exact.
ALTER TABLE usage ADD COLUMN token_calls INTEGER NOT NULL DEFAULT 0;

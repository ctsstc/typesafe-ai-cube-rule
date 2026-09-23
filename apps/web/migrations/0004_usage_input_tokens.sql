-- Jev input tokens per UTC day, summed from each successful call's usage.input_tokens.
ALTER TABLE usage ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;

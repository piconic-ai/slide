-- Migration number: 0021 	 2026-11-17T01:00:00.000Z
-- An operator's decision to hide a deck from everyone, kept apart from the
-- author's publication columns so that releasing it brings back whatever the
-- author had chosen. The three columns are set and cleared together. The
-- application parses a row that sets only some of them as invalid.
ALTER TABLE decks ADD COLUMN hidden_at INTEGER;
ALTER TABLE decks ADD COLUMN hidden_reason TEXT CHECK (hidden_reason IS NULL OR length(hidden_reason) BETWEEN 1 AND 500);
ALTER TABLE decks ADD COLUMN hidden_by TEXT CHECK (hidden_by IS NULL OR length(hidden_by) BETWEEN 1 AND 320);

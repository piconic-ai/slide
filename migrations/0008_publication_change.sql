-- Migration number: 0008 	 2026-11-06T13:00:00.000Z
-- A random ID written by every publication change, so statements in the same
-- batch can act only when that very update was stored.
ALTER TABLE decks ADD COLUMN change_id TEXT;

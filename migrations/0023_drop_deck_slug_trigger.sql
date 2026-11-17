-- Migration number: 0023 	 2026-11-17T15:00:00.000Z
-- The trigger from 0022 gave a slug to decks created by a Worker that did not
-- know the column. Every Worker that can still be deployed writes the slug
-- itself, so the trigger has nothing left to do. No row changes.
DROP TRIGGER IF EXISTS decks_slug_from_id;

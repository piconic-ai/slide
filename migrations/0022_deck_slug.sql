-- Migration number: 0022 	 2026-11-17T03:00:00.000Z
-- The name an author chooses for a deck (the last part of /@handle/slug) gets
-- its own column, so that decks.id can become a key the author does not pick.
-- Every existing deck keeps id = slug. The column stays nullable because
-- SQLite cannot add NOT NULL without a default, so the application parses the
-- column as a string where it reads a row. Nothing is dropped.
ALTER TABLE decks ADD COLUMN slug TEXT;
UPDATE decks SET slug = id;
CREATE UNIQUE INDEX decks_owner_slug ON decks(owner_user_id, slug);
-- A Worker that does not know slug (the previous version, during a deploy or
-- after a rollback) still creates decks with the slug as id. This gives such
-- a row the same slug, so both versions find it by the same name.
CREATE TRIGGER decks_slug_from_id AFTER INSERT ON decks
WHEN NEW.slug IS NULL
BEGIN
  UPDATE decks SET slug = NEW.id WHERE id = NEW.id;
END;

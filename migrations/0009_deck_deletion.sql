-- Migration number: 0009 	 2026-11-06T15:00:00.000Z
-- A deleted deck is kept as a tombstone until its objects and rows are
-- purged. It points at no deployment, so nothing of it is delivered.
ALTER TABLE decks ADD COLUMN deleted_at INTEGER
  CHECK(deleted_at IS NULL OR (public_deployment_id IS NULL AND resume_deployment_id IS NULL));
CREATE INDEX decks_deleted_at ON decks(deleted_at);

-- The prefix of each purged deployment, so an object that a receive writes
-- after the purge is still found and removed. It holds no author data.
CREATE TABLE purged_prefixes (
  deployment_id TEXT PRIMARY KEY,
  purged_at INTEGER NOT NULL,
  sweep_after INTEGER NOT NULL
);
CREATE INDEX purged_prefixes_sweep_after ON purged_prefixes(sweep_after);

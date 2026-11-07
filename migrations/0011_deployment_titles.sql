-- Migration number: 0011 	 2026-11-07T12:00:00.000Z
-- The title a deployment's index.html declares in <title>, read when the
-- upload becomes ready, so deck lists can name decks without reading R2.
-- NULL when the entry has no usable title, and for deployments made ready
-- before this migration. Lists then show the deck ID.
ALTER TABLE deployments ADD COLUMN title TEXT CHECK (
  title IS NULL OR length(title) BETWEEN 1 AND 200
);

-- Migration number: 0039 	 2026-11-22T00:00:00.000Z
-- Related links: a recording, a blog post or another page the author attaches
-- to one deck. They belong to the deck, not to a version, so a new version
-- keeps them. position grows with every link added and is never reused, so the
-- order is the order of adding. The limit of 10 per deck is kept by the insert
-- itself, not by this table.
CREATE TABLE related_links (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL REFERENCES decks (id),
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CONSTRAINT related_link_kind CHECK (kind IN ('video', 'article', 'other')),
  CONSTRAINT related_link_title CHECK (length(title) BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX related_links_order ON related_links (deck_id, position);

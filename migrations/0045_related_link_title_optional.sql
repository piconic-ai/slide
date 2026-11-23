-- Migration number: 0045 	 2026-11-23T00:00:00.000Z
-- A related link's title may be empty: it is fetched once when the link is
-- added, and a link whose title could not be fetched keeps none and is shown
-- by the name of its site. SQLite cannot drop NOT NULL in place, so the table
-- is rebuilt and every row is carried over as it is. Nothing refers to it.
CREATE TABLE related_links_new (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL REFERENCES decks (id),
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CONSTRAINT related_link_kind CHECK (kind IN ('video', 'article', 'other')),
  CONSTRAINT related_link_title CHECK (title IS NULL OR length(title) BETWEEN 1 AND 100)
);
INSERT INTO related_links_new (id, deck_id, kind, url, title, position, created_at)
  SELECT id, deck_id, kind, url, title, position, created_at FROM related_links;
DROP TABLE related_links;
ALTER TABLE related_links_new RENAME TO related_links;
CREATE UNIQUE INDEX related_links_order ON related_links (deck_id, position);

-- The article an author writes under a deck: a transcript of the talk in
-- Markdown, shown below the slides. One per deck, owned by the deck and not by
-- a version, so a new version keeps it. A draft is seen by the author alone.
-- The body is at most 50000 characters (decision D-44).
CREATE TABLE articles (
  deck_id TEXT PRIMARY KEY REFERENCES decks(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (status IN ('draft', 'published')),
  CHECK (length(body) <= 50000)
);

-- The share URLs a published article links to, read when the article is saved
-- or published. A row exists only while the article is published, so
-- unpublishing the article takes its citations away. They name the target as
-- the link spelled it, as `citations` does, and page 0 names the whole deck.
CREATE TABLE article_citations (
  deck_id TEXT NOT NULL REFERENCES decks(id),
  target_handle TEXT NOT NULL,
  target_slug TEXT NOT NULL,
  target_page INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (deck_id, target_handle, target_slug, target_page),
  CHECK (target_page BETWEEN 0 AND 9999)
);
CREATE INDEX article_citations_target ON article_citations (target_handle, target_slug);

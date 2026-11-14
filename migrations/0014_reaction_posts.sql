-- Migration number: 0014 	 2026-11-13T01:00:00.000Z
-- Trial of showing posts on X and Bluesky beside a deck. A post attaches to
-- one page of the deck, or to the whole deck as page 0.

-- Posts shown under a deck. A pasted post was chosen by the deck's owner.
-- A collected one was found by searching for the deck's share URL.
CREATE TABLE reaction_posts (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL REFERENCES decks(id),
  page INTEGER NOT NULL DEFAULT 0,
  service TEXT NOT NULL,
  -- X: the status ID. Bluesky: the author's DID and the record key.
  post_key TEXT NOT NULL,
  source TEXT NOT NULL,
  -- Seconds since the epoch, when the post's ID or record tells it.
  posted_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (deck_id, service, post_key),
  CHECK (page BETWEEN 0 AND 9999),
  CHECK (service IN ('x', 'bluesky')),
  CHECK (source IN ('pasted', 'collected'))
);

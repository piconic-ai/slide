-- Migration number: 0015 	 2026-11-14T00:00:00.000Z
-- Trial of showing where a deck was presented: a community holds events,
-- and an event lists its talks. A talk is a deck here, or slides published
-- on another service.

CREATE TABLE communities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  -- Without the leading number sign.
  hashtag TEXT,
  -- The local date of the event, as YYYY-MM-DD.
  held_on TEXT NOT NULL
);

-- Exactly one of deck_id and url is set. For slides elsewhere, embed_url is
-- the address of that service's player, where it has one.
CREATE TABLE event_talks (
  event_id TEXT NOT NULL REFERENCES events(id),
  position INTEGER NOT NULL,
  deck_id TEXT REFERENCES decks(id),
  title TEXT,
  speaker TEXT,
  url TEXT,
  embed_url TEXT,
  PRIMARY KEY (event_id, position),
  -- A deck is one talk of an event.
  UNIQUE (event_id, deck_id),
  CHECK (position >= 0),
  CHECK ((deck_id IS NULL) <> (url IS NULL))
);
CREATE INDEX event_talks_deck ON event_talks (deck_id);

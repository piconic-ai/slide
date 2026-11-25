-- Migration number: 0050 	 2026-11-25T00:00:00.000Z
-- Events that slides were given as talks of (docs/dev/f29-event-talks.md).
-- An event is never fetched: it is known only by the address its related
-- links carry, made into one key. id is the number in /events/:id. name is
-- the first title one of its links was saved with, or the one an operator set
-- (named_by and named_at say who and when), and NULL shows the service and number.
-- An event stays when its last link goes: its page is then not found, and
-- the same address brings it back.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE CHECK (length(key) BETWEEN 1 AND 2100),
  service TEXT NOT NULL CHECK (service IN ('connpass', 'doorkeeper', 'luma', 'web')),
  ref TEXT NOT NULL CHECK (length(ref) BETWEEN 1 AND 2100),
  host TEXT NOT NULL CHECK (length(host) BETWEEN 1 AND 300),
  url TEXT NOT NULL CHECK (length(url) BETWEEN 1 AND 2100),
  name TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 100),
  named_by TEXT CHECK (named_by IS NULL OR length(named_by) BETWEEN 1 AND 320),
  named_at INTEGER,
  created_at INTEGER NOT NULL,
  CONSTRAINT event_named CHECK ((named_by IS NULL) = (named_at IS NULL)),
  CONSTRAINT event_named_has_name CHECK (named_by IS NULL OR name IS NOT NULL)
);
-- Which event a related link of the kind "event" is a talk of. related_links
-- keeps its CHECK of three kinds, which cannot change without rebuilding the
-- table: a link with a row here is of the kind "event", whatever its kind
-- column says (the service writes 'other' there). One link is in one event.
CREATE TABLE related_link_events (
  link_id TEXT PRIMARY KEY REFERENCES related_links (id),
  event_id INTEGER NOT NULL REFERENCES events (id),
  created_at INTEGER NOT NULL
);
CREATE INDEX related_link_events_event ON related_link_events (event_id);

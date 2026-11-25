-- Migration number: 0052 	 2026-11-25T06:00:00.000Z
-- Communities (docs/dev/f30-communities.md). A community's handle is not
-- here: it is held in `handles` (owner_kind 'community', owner_id the id as
-- text), like a person's. id is a positive number the service picks at
-- random before the handle is taken, and it is also the seed of the default
-- cover's pattern (D-46). color is one of the five colors (D-45) and never
-- changes. sites are the other links (D-37), a JSON array of up to three
-- addresses. logo_at and cover_at are when the uploaded logo and cover were
-- put up, in milliseconds (their version in the address), NULL for the
-- initial and the default pattern.
CREATE TABLE communities (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 160),
  color TEXT NOT NULL CHECK (color IN ('red', 'orange', 'yellow', 'green', 'navy')),
  sites TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(sites) AND json_type(sites) = 'array' AND json_array_length(sites) <= 3),
  logo_at INTEGER,
  cover_at INTEGER,
  created_at INTEGER NOT NULL
);
-- The people who run a community (D-37, D-38). The last one cannot leave:
-- the service keeps that, not a constraint.
CREATE TABLE community_admins (
  community_id INTEGER NOT NULL REFERENCES communities (id),
  user_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX community_admins_user ON community_admins (user_id);
-- The links slides are gathered by (D-32). url is the link as the service
-- writes it, unique: one link belongs to one community (D-34). host is what
-- an event's links are matched against (D-33): the group's or the site's
-- host. A Luma calendar has none: its events come from its feed (work L),
-- kept in community_feed_events.
CREATE TABLE community_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  community_id INTEGER NOT NULL REFERENCES communities (id),
  url TEXT NOT NULL UNIQUE CHECK (length(url) BETWEEN 1 AND 300),
  kind TEXT NOT NULL CHECK (kind IN ('connpass', 'doorkeeper', 'luma', 'web')),
  host TEXT CHECK (host IS NULL OR length(host) BETWEEN 1 AND 253),
  created_at INTEGER NOT NULL,
  CONSTRAINT community_link_host CHECK ((kind = 'luma') = (host IS NULL))
);
CREATE INDEX community_links_community ON community_links (community_id);
CREATE UNIQUE INDEX community_links_host ON community_links (host) WHERE host IS NOT NULL;
-- The events a Luma calendar's feed lists, by their key (D-68): written by
-- the work that reads the feeds, matched against events.key. An event the
-- feed lists before any slide links it waits here.
CREATE TABLE community_feed_events (
  link_id INTEGER NOT NULL REFERENCES community_links (id),
  event_key TEXT NOT NULL CHECK (length(event_key) BETWEEN 1 AND 2100),
  added_at INTEGER NOT NULL,
  PRIMARY KEY (link_id, event_key)
);
CREATE INDEX community_feed_events_key ON community_feed_events (event_key);
-- A community finds its events by the hosts of their links.
CREATE INDEX related_link_events_host ON related_link_events (host);

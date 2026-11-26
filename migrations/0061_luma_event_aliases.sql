-- Migration number: 0061 	 2026-11-26T12:00:00.000Z
-- Luma gives an event two addresses: its name (luma.com/<name>) and its id
-- (luma.com/event/evt-...). A calendar feed lists both for each event, and
-- each id key is kept with the name key of the same event, so a link written
-- with the id joins the event of the name (docs/features/f33-luma-feeds.md,
-- F33-AC20). Only keys are kept (D-60).
CREATE TABLE luma_event_aliases (
  alias_key TEXT PRIMARY KEY NOT NULL,
  event_key TEXT NOT NULL,
  added_at INTEGER NOT NULL
);
-- Before 0061 a link of the kind event to luma.com/event/evt-... made an
-- event of the service web, with the key https://luma.com/event/evt-...,
-- such an event is now one of Luma, its ref the id.
UPDATE events
SET service = 'luma', ref = substr(key, length('https://luma.com/event/') + 1), url = key
WHERE service = 'web' AND key GLOB 'https://luma.com/event/evt-[A-Za-z0-9]*'
  AND substr(key, length('https://luma.com/event/evt-') + 1) NOT GLOB '*[^A-Za-z0-9]*';
-- Feeds read before 0061 were read without pairing. Their next read asks
-- for the whole feed, so its pairs are found even while it is unchanged.
UPDATE luma_feeds SET etag = NULL, last_modified = NULL;

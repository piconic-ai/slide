-- Migration number: 0053 	 2026-11-25T09:00:00.000Z
-- How the service reads Luma calendars' iCal feeds (docs/dev/f33-luma-feeds.md).
-- One row a feed, by its address as community_links.url writes it. It is not
-- tied to the link's row: a link taken away and added again is the same feed,
-- and must not be read sooner than the record allows (D-62). Nothing of the
-- feed's contents is here (D-60). Times are in seconds.
--   read_at        when the feed was last asked for, NULL before the first time
--   not_before     the feed is not asked for before this (D-62, D-65)
--   due_at         when the feed is next to be read: a day after the last
--                  read, or at once when an early read is asked for (D-61)
--   retry_until    the time a 429 or 503 named in Retry-After (D-65)
--   etag, last_modified   the validators of the last full answer (D-64)
--   failures       failures in a row (D-65)
--   last_failure   why the last read failed
--   stopped_at     set after the fifth failure in a row: the feed is not read
--                  until an operator resumes it (D-65)
CREATE TABLE luma_feeds (
  url TEXT PRIMARY KEY NOT NULL CHECK (length(url) BETWEEN 1 AND 300),
  read_at INTEGER,
  not_before INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL DEFAULT 0,
  retry_until INTEGER,
  etag TEXT CHECK (etag IS NULL OR length(etag) BETWEEN 1 AND 256),
  last_modified TEXT CHECK (last_modified IS NULL OR length(last_modified) BETWEEN 1 AND 64),
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  last_failure TEXT CHECK (last_failure IS NULL OR last_failure IN (
    'refused', 'redirect', 'http_error', 'rate_limited', 'unavailable',
    'too_large', 'timeout', 'network', 'not_calendar', 'interrupted')),
  stopped_at INTEGER,
  CONSTRAINT luma_feed_stopped CHECK (stopped_at IS NULL OR last_failure IS NOT NULL)
);
CREATE INDEX luma_feeds_due ON luma_feeds (due_at) WHERE stopped_at IS NULL;
-- The one gate every request to Luma passes (D-63): one at a time
-- (busy_until, a lease that runs out by itself if a reader dies) and no
-- sooner than six seconds after the one before (next_start_at), so no
-- minute holds more than ten. In milliseconds.
CREATE TABLE luma_feed_gate (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  busy_until INTEGER NOT NULL,
  next_start_at INTEGER NOT NULL
);
INSERT INTO luma_feed_gate (id, busy_until, next_start_at) VALUES (1, 0, 0);

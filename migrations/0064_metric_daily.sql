-- Migration number: 0064 	 2026-11-26T11:00:00.000Z
-- What was counted each day, copied once a day from Analytics Engine where the
-- service writes its events (docs/dev/metrics.md). Analytics Engine keeps its
-- records for three months and these stay. A row is a group of events of one
-- UTC day, and holds no address, no IP address, no person's number and no
-- cookie: the columns are only what an event may carry (src/metrics/events.ts).
--   day        the UTC day, YYYY-MM-DD
--   event      the event's name
--   detail     the event's kind: a reason, a tool, a view, a help search word
--              of 50 characters at most, a help article. Empty when it has none
--   referrer   the host a reader came from, or 'internal', or empty
--   lang       'ja', 'en' or empty
--   screen     the route pattern an error page was shown for, or empty
--   events     how many, made up for sampling, so an estimate
--   value_sum  the sum of the events' values, made up for sampling
-- A day is copied in place of what it held, so copying it again does not
-- double a count. The scope's slides and communities are not kept per row.
CREATE TABLE metric_daily (
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  event TEXT NOT NULL CHECK (length(event) BETWEEN 1 AND 40),
  detail TEXT NOT NULL CHECK (length(detail) <= 200),
  referrer TEXT NOT NULL CHECK (length(referrer) <= 253),
  lang TEXT NOT NULL CHECK (lang IN ('', 'ja', 'en')),
  screen TEXT NOT NULL CHECK (length(screen) <= 80),
  events INTEGER NOT NULL CHECK (events >= 0),
  value_sum REAL NOT NULL CHECK (value_sum >= 0),
  PRIMARY KEY (day, event, detail, referrer, lang, screen)
) WITHOUT ROWID;
-- One row for each day that was copied, even a day with no events, so that the
-- next copy knows which days are left and the operator's page knows how fresh
-- the numbers are.
--   copied_at  when it was copied, in seconds
--   row_count  how many rows were written for it
--   was_cut    1 when the day had more groups than a copy holds
CREATE TABLE metric_days (
  day TEXT PRIMARY KEY NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  copied_at INTEGER NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  was_cut INTEGER NOT NULL CHECK (was_cut IN (0, 1))
) WITHOUT ROWID;

-- Migration number: 0059 	 2026-11-26T09:00:00.000Z
-- The alerts the service raises (docs/dev/alerts.md). One row an alert, in
-- two lives. An alert told at once (urgency 'immediate') is a row from the
-- moment it is sent, so that the same kind is told once an hour and the
-- operations page can list what was told. An alert told the next day (urgency
-- 'next_day') waits as a 'queued' row until the daily mail takes it, and is
-- then marked 'mailed'. A row holds a kind, a count, a link and, for a cron
-- task that failed, the task's name: never an address, an IP address or a
-- person's name (D-58). Times are in seconds.
--   kind        a key of ALERT_URGENCY in src/alerts/notice.ts, not checked
--               here, so that a new kind is not a new migration
--   count       how many, and for 'd1_size' it is the size in megabytes
--   link        a path of the operator page or of a document
--   task        the snake_case name of a cron task, for kind 'cron_failed'
--   phase       which of 'started', 'ended' and 'overrun' maintenance is told
--               as, for kind 'maintenance' and for no other: each phase is held
--               back on its own, so that the end is not lost to the start
--   raised_at   when the alert was raised
--   state       immediate: 'sending' (claimed, not yet answered), 'sent',
--               'failed' (not delivered for a reason that may pass, a 5xx, a
--               time out or a 429, so it does not hold back the next one),
--               'refused' (Discord answered with another 4xx: the address is
--               dead, so it holds back like a sent one), 'not_configured' (no
--               webhook was set),
--               next day: 'queued', 'mailed'
--   mailed_at   when the daily mail took it, set exactly when state is 'mailed'
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
  urgency TEXT NOT NULL CHECK (urgency IN ('immediate', 'next_day')),
  count INTEGER NOT NULL CHECK (count >= 0),
  link TEXT NOT NULL CHECK (length(link) BETWEEN 1 AND 200),
  task TEXT CHECK (task IS NULL OR length(task) BETWEEN 1 AND 40),
  phase TEXT CHECK (phase IS NULL OR phase IN ('started', 'ended', 'overrun')),
  raised_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  mailed_at INTEGER,
  CONSTRAINT alert_state CHECK (
    (urgency = 'immediate' AND state IN ('sending', 'sent', 'failed', 'refused', 'not_configured'))
    OR (urgency = 'next_day' AND state IN ('queued', 'mailed'))
  ),
  CONSTRAINT alert_phase CHECK ((kind = 'maintenance') = (phase IS NOT NULL)),
  CONSTRAINT alert_mailed CHECK ((state = 'mailed') = (mailed_at IS NOT NULL))
);
-- "Was this kind told within the hour?" and the operations page's newest first.
CREATE INDEX alerts_kind_raised ON alerts (kind, raised_at);
CREATE INDEX alerts_raised ON alerts (raised_at);
-- The next-day mail reads what is queued.
CREATE INDEX alerts_queued ON alerts (id) WHERE state = 'queued';

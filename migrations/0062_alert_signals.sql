-- Migration number: 0062 	 2026-11-26T09:10:00.000Z
-- Things that happened, kept only so that they can be counted within a
-- window before an alert is raised (docs/dev/alerts.md). Today that is the
-- failures to send login mail, which raise an alert when enough of them
-- fall within an hour (D-56). A row holds a kind and the time, in seconds,
-- and nothing of who or what: no address, no IP address, no person. Rows
-- older than a day are deleted when a new one is written.
CREATE TABLE alert_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
  at INTEGER NOT NULL
);
-- Counting one kind within a window.
CREATE INDEX alert_signals_kind_at ON alert_signals (kind, at);

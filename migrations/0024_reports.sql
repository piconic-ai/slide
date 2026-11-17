-- Migration number: 0024 	 2026-11-18T01:00:00.000Z
-- A reader's report keeps the share path and deployment they were viewing.
-- The reporter may be absent when reporting without sign-in is added later.
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL REFERENCES decks(id),
  deployment_id TEXT NOT NULL,
  share_path TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL,
  reporter_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CONSTRAINT report_reason CHECK (reason IN ('nuisance', 'rights', 'other'))
);
CREATE UNIQUE INDEX reports_deck_reporter ON reports(deck_id, reporter_user_id);

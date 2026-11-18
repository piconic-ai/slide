-- Migration number: 0026 	 2026-11-18T03:00:00.000Z
-- Each pair of GitHub user IDs records one viewer's mute of another author.
CREATE TABLE mutes (
  muter_user_id TEXT NOT NULL,
  muted_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (muter_user_id, muted_user_id),
  CONSTRAINT mute_other_user CHECK (muter_user_id <> muted_user_id)
);

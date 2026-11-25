-- Migration number: 0053 	 2026-11-25T06:00:00.000Z
-- Each pair of user IDs records one person's block of another
-- (docs/dev/f32-block.md). The pair is unique, and nobody blocks themselves.
-- The index on the blocked side serves the lookups that ask who blocked a
-- person, such as whether that person may follow.
CREATE TABLE blocks (
  blocker_user_id TEXT NOT NULL,
  blocked_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CONSTRAINT block_other_user CHECK (blocker_user_id <> blocked_user_id)
);
CREATE INDEX blocks_blocked ON blocks (blocked_user_id);

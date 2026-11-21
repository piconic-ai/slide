-- Migration number: 0038 	 2026-11-22T00:00:00.000Z
-- What was kept for GitHub sign-in is gone. owner_sessions (from 0004) held a
-- GitHub user id and login and has had no reader since 0012. And "someone you
-- follow on GitHub joined" is not a notification any more, so notifications
-- is rebuilt without that kind, its rows and opt-outs are not carried over.
DROP TABLE owner_sessions;
DROP TABLE notifications;
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  deck_id TEXT,
  target_deck_id TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  CONSTRAINT notification_shape CHECK (
    (kind = 'cited' AND deck_id IS NOT NULL AND target_deck_id IS NOT NULL)
    OR (kind = 'followee_published' AND deck_id IS NOT NULL AND target_deck_id IS NULL)
    OR (kind = 'followed' AND deck_id IS NULL AND target_deck_id IS NULL)
  ),
  CONSTRAINT notification_other_user CHECK (recipient_user_id <> actor_user_id)
);
CREATE UNIQUE INDEX notifications_once ON notifications (
  recipient_user_id, kind, actor_user_id, coalesce(deck_id, ''), coalesce(target_deck_id, ''));
CREATE INDEX notifications_recipient ON notifications (recipient_user_id, created_at);
DELETE FROM notification_opt_outs;

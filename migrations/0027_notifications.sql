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
    OR (kind IN ('github_followee_joined', 'followed') AND deck_id IS NULL AND target_deck_id IS NULL)
  ),
  CONSTRAINT notification_other_user CHECK (recipient_user_id <> actor_user_id)
);
CREATE UNIQUE INDEX notifications_once ON notifications (
  recipient_user_id, kind, actor_user_id, coalesce(deck_id, ''), coalesce(target_deck_id, ''));
CREATE INDEX notifications_recipient ON notifications (recipient_user_id, created_at);
CREATE TABLE notification_opt_outs (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
);

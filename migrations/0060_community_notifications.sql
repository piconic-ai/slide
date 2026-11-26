-- Migration number: 0060 	 2026-11-26T00:00:00.000Z
-- A person who follows a community is told when a new slide comes into it
-- (F20-AC15). The table is rebuilt for the new kind and its column
-- community_id (the community the slide is shown under, for the wording
-- only). Every row is copied first, so the notifications that exist stay.
-- A recipient gets one such notice per slide, whether it is from the person
-- they follow or from a community, so the unique index spans both kinds.
PRAGMA defer_foreign_keys = on;

CREATE TABLE notifications_next (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  deck_id TEXT,
  target_deck_id TEXT,
  community_id INTEGER REFERENCES communities (id),
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  CONSTRAINT notification_shape CHECK (
    (kind = 'cited' AND deck_id IS NOT NULL AND target_deck_id IS NOT NULL AND community_id IS NULL)
    OR (kind = 'followee_published' AND deck_id IS NOT NULL AND target_deck_id IS NULL AND community_id IS NULL)
    OR (kind = 'followed' AND deck_id IS NULL AND target_deck_id IS NULL AND community_id IS NULL)
    OR (kind = 'community_published' AND deck_id IS NOT NULL AND target_deck_id IS NULL AND community_id IS NOT NULL)
  ),
  CONSTRAINT notification_other_user CHECK (recipient_user_id <> actor_user_id)
);
INSERT INTO notifications_next
  (id, recipient_user_id, kind, actor_user_id, deck_id, target_deck_id, community_id, created_at, read_at)
  SELECT id, recipient_user_id, kind, actor_user_id, deck_id, target_deck_id, NULL, created_at, read_at
  FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_next RENAME TO notifications;
CREATE UNIQUE INDEX notifications_once ON notifications (
  recipient_user_id, kind, actor_user_id, coalesce(deck_id, ''), coalesce(target_deck_id, ''));
CREATE INDEX notifications_recipient ON notifications (recipient_user_id, created_at);
CREATE UNIQUE INDEX notifications_deck_once ON notifications (recipient_user_id, deck_id)
  WHERE kind IN ('followee_published', 'community_published');
-- Deleting a community deletes its notifications first (the service does it).
CREATE INDEX notifications_community ON notifications (community_id) WHERE community_id IS NOT NULL;

PRAGMA defer_foreign_keys = off;

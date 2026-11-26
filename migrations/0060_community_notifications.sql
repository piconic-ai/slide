-- Migration number: 0060 	 2026-11-26T00:00:00.000Z
-- A person who follows a community is told when a new slide comes into it
-- (F20-AC15). The table is dropped and made again for the new kind and its
-- column community_id (the community the slide is shown under, for the
-- wording only): the service has one user so far, and the requester agreed
-- that the notifications may go (2026-11-26). Nothing else refers to the
-- table. A recipient gets one notice per slide, whether it is from the person
-- they follow or from a community, so the unique index spans both kinds.
DROP TABLE notifications;
CREATE TABLE notifications (
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
CREATE UNIQUE INDEX notifications_once ON notifications (
  recipient_user_id, kind, actor_user_id, coalesce(deck_id, ''), coalesce(target_deck_id, ''));
CREATE INDEX notifications_recipient ON notifications (recipient_user_id, created_at);
CREATE UNIQUE INDEX notifications_deck_once ON notifications (recipient_user_id, deck_id)
  WHERE kind IN ('followee_published', 'community_published');
-- Deleting a community deletes its notifications first (the service does it).
CREATE INDEX notifications_community ON notifications (community_id) WHERE community_id IS NOT NULL;

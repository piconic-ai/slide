-- Migration number: 0054 	 2026-11-25T09:00:00.000Z
-- Who follows which community (docs/dev/f31-community-follow.md). The pair
-- is unique. A person who leaves, and a community that is deleted, take
-- their rows with them: the service deletes them, not a constraint.
CREATE TABLE community_follows (
  user_id TEXT NOT NULL,
  community_id INTEGER NOT NULL REFERENCES communities (id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, community_id)
);
-- A community's followers tab, the newest follow first.
CREATE INDEX community_follows_community ON community_follows (community_id, created_at);

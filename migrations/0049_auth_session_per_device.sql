-- Migration number: 0049 	 2026-11-25T00:00:00.000Z
-- A person may be signed in on several devices at once (F28-AC102), so the
-- table is rebuilt without the one-session-per-person constraint. Every row
-- is copied first, so every sign-in that exists keeps working. The index
-- keeps lookups by person (sign out everywhere, count other devices) cheap.
PRAGMA defer_foreign_keys = on;

CREATE TABLE auth_session_next (
  id TEXT PRIMARY KEY NOT NULL, token TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  ip_address TEXT, user_agent TEXT
);
INSERT INTO auth_session_next
  SELECT id, token, user_id, expires_at, created_at, updated_at, ip_address, user_agent
  FROM auth_session;
DROP TABLE auth_session;
ALTER TABLE auth_session_next RENAME TO auth_session;
CREATE INDEX auth_session_user ON auth_session(user_id);

PRAGMA defer_foreign_keys = off;

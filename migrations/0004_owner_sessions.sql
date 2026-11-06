-- Migration number: 0004 	 2026-11-06T03:07:43.829Z
-- Browser sessions for the allowed owner. Only a hash of the cookie value is
-- stored, and GitHub tokens are never stored.
CREATE TABLE owner_sessions (
  token_hash TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK(expires_at > created_at)
);
CREATE INDEX owner_sessions_expires_at ON owner_sessions(expires_at);

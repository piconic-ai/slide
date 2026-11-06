-- Migration number: 0010 	 2026-11-08T00:00:00.000Z
-- The handle that names an owner in share URLs such as /@handle/slug. It is
-- the GitHub login, lowercased, recorded at the first sign-in and kept when
-- the GitHub login changes, so shared links stay stable. Handles name decks
-- in URLs only and never authorize anything.
CREATE TABLE accounts (
  user_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  CHECK (
    length(handle) BETWEEN 1 AND 39
    AND handle NOT GLOB '*[^a-z0-9-]*'
    AND handle NOT GLOB '-*'
  )
);

-- Owners who signed in before handles existed keep the login they used.
INSERT OR IGNORE INTO accounts (user_id, handle, created_at)
SELECT github_user_id, lower(github_login), created_at FROM owner_sessions;

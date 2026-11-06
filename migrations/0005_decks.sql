-- Migration number: 0005 	 2026-11-06T03:17:33.173Z
-- Decks owned by the signed-in owner, and the repository each deck accepts
-- uploads from. Several decks may name the same repository.
CREATE TABLE decks (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE repository_bindings (
  deck_id TEXT PRIMARY KEY REFERENCES decks(id),
  repository_id TEXT NOT NULL,
  repository_owner_id TEXT NOT NULL,
  repository_full_name TEXT NOT NULL,
  -- JSON array of fully qualified branch refs such as "refs/heads/main".
  allowed_refs TEXT NOT NULL,
  verified_by TEXT NOT NULL,
  verified_at INTEGER NOT NULL
);

ALTER TABLE deployments ADD COLUMN deck_id TEXT REFERENCES decks(id);
CREATE INDEX deployments_deck_created ON deployments(deck_id, created_at);

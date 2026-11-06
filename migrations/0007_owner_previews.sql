-- Migration number: 0007 	 2026-11-06T10:00:00.000Z
-- One-time launch tokens and the sessions they open for owner-only viewing
-- of one deployment on its own content origin. Only hashes are stored.
-- Revoking a session deletes its row.
CREATE TABLE preview_launches (
  token_hash TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL REFERENCES deployments(id),
  owner_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  -- The session the launch opened, so a racing second use cannot open one.
  session_hash TEXT,
  CHECK(expires_at > created_at),
  CHECK((consumed_at IS NULL) = (session_hash IS NULL))
);
CREATE INDEX preview_launches_expires_at ON preview_launches(expires_at);
CREATE INDEX preview_launches_deployment ON preview_launches(deployment_id);

CREATE TABLE content_sessions (
  token_hash TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL REFERENCES deployments(id),
  owner_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- Extended while the owner keeps viewing, but never past the hard limit.
  expires_at INTEGER NOT NULL,
  hard_expires_at INTEGER NOT NULL,
  CHECK(expires_at > created_at AND expires_at <= hard_expires_at)
);
CREATE INDEX content_sessions_deployment ON content_sessions(deployment_id);
CREATE INDEX content_sessions_expires_at ON content_sessions(expires_at);

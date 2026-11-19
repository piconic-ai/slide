-- The OAuth authorization server behind /mcp. Tokens and codes are kept as
-- SHA-256 hashes only. Owners are GitHub user IDs, as in decks, and name an
-- account, so deleting the account removes its codes and grants too.
CREATE TABLE mcp_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE mcp_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES mcp_clients (id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX mcp_codes_client ON mcp_codes (client_id);
CREATE INDEX mcp_codes_owner ON mcp_codes (owner_user_id);

CREATE TABLE mcp_grants (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES mcp_clients (id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  access_token_hash TEXT NOT NULL UNIQUE,
  access_expires_at INTEGER NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  previous_refresh_token_hash TEXT,
  refresh_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX mcp_grants_client ON mcp_grants (client_id);
CREATE INDEX mcp_grants_owner ON mcp_grants (owner_user_id);
CREATE INDEX mcp_grants_previous ON mcp_grants (previous_refresh_token_hash);

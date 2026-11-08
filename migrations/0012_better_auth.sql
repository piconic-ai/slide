CREATE TABLE auth_user (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE auth_session (
  id TEXT PRIMARY KEY NOT NULL, token TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  ip_address TEXT, user_agent TEXT,
  CONSTRAINT auth_session_user_unique UNIQUE(user_id) ON CONFLICT REPLACE
);
CREATE TABLE auth_account (
  id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  access_token TEXT, refresh_token TEXT, id_token TEXT,
  access_token_expires_at INTEGER, refresh_token_expires_at INTEGER, scope TEXT, password TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX auth_account_provider_identity ON auth_account(provider_id, account_id);
CREATE INDEX auth_account_user ON auth_account(user_id);
CREATE TABLE auth_verification (
  id TEXT PRIMARY KEY NOT NULL, identifier TEXT NOT NULL, value TEXT NOT NULL,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX auth_verification_identifier ON auth_verification(identifier);
DROP TABLE owner_sessions;

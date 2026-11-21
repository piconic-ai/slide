-- Migration number: 0036 	 2026-11-22T00:00:00.000Z
-- Email login (F28). The people the operator invited, by email address, the
-- local mail outbox, which stands in for a mail service wherever no real one
-- is set up, and the log of login codes asked for, which the limits count.
CREATE TABLE invited_emails (
  -- Normalized: trimmed and lowercased, see src/mail/address.ts.
  email TEXT PRIMARY KEY CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  invited_at INTEGER NOT NULL,
  invited_by TEXT NOT NULL CHECK (length(invited_by) BETWEEN 1 AND 320)
);
CREATE TABLE mail_outbox (
  id TEXT PRIMARY KEY,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX mail_outbox_created ON mail_outbox (created_at);
-- One row per code asked for ('send') or per try at entering one ('attempt'),
-- invited or not. Only hashes are kept, so the log holds no address and no IP
-- address.
CREATE TABLE login_code_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('send', 'attempt')),
  address_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  requested_at INTEGER NOT NULL
);
CREATE INDEX login_code_requests_address ON login_code_requests (kind, address_hash, requested_at);
CREATE INDEX login_code_requests_source ON login_code_requests (kind, source_hash, requested_at);

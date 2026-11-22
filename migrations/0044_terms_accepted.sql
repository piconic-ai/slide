-- Migration number: 0044 	 2026-11-23T00:00:00.000Z
-- When a person agreed to the terms and the privacy policy, in seconds. It is
-- written in the same batch that creates the account (at /welcome), so an
-- account and its consent are one row and cannot part. NULL for an account
-- made before consent was asked for. No version of the terms is kept yet.
ALTER TABLE accounts ADD COLUMN terms_accepted_at INTEGER;

-- Migration number: 0060 	 2026-11-26T09:00:01.000Z
-- The rows still to be rewritten (F41-AC8), found without reading the whole
-- table: the index holds only the plain ones, so it empties as the operator
-- rewrites them.
CREATE INDEX auth_user_plain_email ON auth_user (id) WHERE email_ciphertext IS NULL;
CREATE INDEX invited_emails_plain_email ON invited_emails (email) WHERE email_ciphertext IS NULL;

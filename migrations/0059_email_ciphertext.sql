-- Migration number: 0059 	 2026-11-26T09:00:00.000Z
-- Registrants' email addresses, sealed (F41, docs/dev/f41-email-encryption.md).
-- Each of the two tables that hold an address gains the sealed text. A row is
-- either plain (email_ciphertext is NULL and email is the address, as before)
-- or sealed (email_ciphertext holds the sealed address and email holds
-- 'enc1:' and the 64 hexadecimal digits of the address's lookup value). The
-- email column keeps its NOT NULL and UNIQUE (or PRIMARY KEY), so a lookup
-- value stays one row per address. Nothing is dropped or rewritten here: the
-- existing rows stay plain until the operator rewrites them.
ALTER TABLE auth_user ADD COLUMN email_ciphertext TEXT
  CHECK ((email_ciphertext IS NULL) = (substr(email, 1, 5) <> 'enc1:'));
ALTER TABLE invited_emails ADD COLUMN email_ciphertext TEXT
  CHECK ((email_ciphertext IS NULL) = (substr(email, 1, 5) <> 'enc1:'));

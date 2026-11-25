-- Migration number: 0050 	 2026-11-25T12:00:00.000Z
-- The rough name of the device a session signed in from ("iPhone · Safari"),
-- so a person can tell their sign-ins apart and sign one out (F28-AC108).
-- Made from the user agent at sign-in. The agent itself is not kept.
ALTER TABLE auth_session ADD COLUMN device TEXT;

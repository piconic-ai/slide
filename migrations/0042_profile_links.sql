-- Migration number: 0042 	 2026-11-22T00:00:00.000Z
-- What an author writes on their profile beyond 0037's columns: up to three
-- links to social accounts, in the order they wrote them, and whether their
-- Gravatar picture may be shown (on unless they turn it off). No rows exist to
-- carry over. A link is an https address, which the service checks before it
-- stores one and again when it reads one.
CREATE TABLE profile_links (
  user_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 3),
  url TEXT NOT NULL CHECK (length(url) BETWEEN 1 AND 2048),
  PRIMARY KEY (user_id, position)
);
ALTER TABLE profiles ADD COLUMN use_gravatar INTEGER NOT NULL DEFAULT 1 CHECK (use_gravatar IN (0, 1));

-- Migration number: 0018 	 2026-11-15T02:00:00.000Z
-- An author's public GitHub profile, copied at each sign-in and shown on
-- their profile page. Keyed by the GitHub user ID, as accounts is. The login
-- here is the current one, for display and links to GitHub. The handle in
-- accounts stays the one of the first sign-in. Every other column is NULL
-- when the author's GitHub profile leaves it empty, or names something the
-- service does not show.
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY,
  login TEXT NOT NULL CHECK (length(login) BETWEEN 1 AND 39),
  name TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 255),
  avatar_url TEXT CHECK (avatar_url IS NULL OR length(avatar_url) BETWEEN 1 AND 2048),
  location TEXT CHECK (location IS NULL OR length(location) BETWEEN 1 AND 255),
  website TEXT CHECK (website IS NULL OR length(website) BETWEEN 1 AND 2048),
  has_sponsors INTEGER NOT NULL DEFAULT 0 CHECK (has_sponsors IN (0, 1)),
  synced_at INTEGER NOT NULL
);

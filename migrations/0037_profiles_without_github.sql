-- Migration number: 0037 	 2026-11-22T00:00:00.000Z
-- The profile no longer copies GitHub's. It holds what the author wrote: a
-- display name chosen at /welcome, and the optional lines the settings page
-- will gain. Rows are not carried over (the data is emptied before this lands).
DROP TABLE profiles;
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  bio TEXT CHECK (bio IS NULL OR length(bio) BETWEEN 1 AND 160),
  location TEXT CHECK (location IS NULL OR length(location) BETWEEN 1 AND 50),
  website TEXT CHECK (website IS NULL OR length(website) BETWEEN 1 AND 2048)
);

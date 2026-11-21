-- Migration number: 0041 	 2026-11-22T00:00:00.000Z
-- A picture an author uploaded for their profile. The row says one exists and
-- when it was put up. The picture itself is in R2 under avatars/<user_id>,
-- already shrunk to a square. And a record of each time the operator took an
-- uploaded picture down, which stays after the picture is gone.
CREATE TABLE profile_pictures (
  user_id TEXT PRIMARY KEY,
  uploaded_at INTEGER NOT NULL
);
CREATE TABLE picture_removals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  removed_by TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  removed_at INTEGER NOT NULL
);
CREATE INDEX picture_removals_by_user ON picture_removals (user_id);

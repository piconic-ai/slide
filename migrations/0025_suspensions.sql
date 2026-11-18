-- Migration number: 0025 	 2026-11-18T02:00:00.000Z
-- Suspensions use GitHub user IDs and survive account deletion.
CREATE TABLE suspensions (
  user_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  suspended_at INTEGER NOT NULL,
  suspended_by TEXT NOT NULL
);

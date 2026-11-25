-- Migration number: 0049 	 2026-11-25T03:00:00.000Z
-- People and communities share one row of handles (docs/dev/f30-handles.md).
-- `handles` holds every handle in use and who holds it. Its primary key is
-- what keeps a handle to one owner, whether a person or a community.
-- `released_handles` keeps a handle someone let go of (leaving, a deleted
-- community, an operator's change) and when, so nobody takes it for 90 days,
-- and, after an operator's change, whose new handle the old URL moves to.
-- Nothing is dropped: accounts.handle stays, and every existing handle is
-- copied here.
CREATE TABLE handles (
  handle TEXT PRIMARY KEY NOT NULL
    CHECK (length(handle) BETWEEN 1 AND 39 AND handle NOT GLOB '*[^a-z0-9-]*' AND handle NOT GLOB '-*'),
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('person', 'community')),
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX handles_owner ON handles(owner_kind, owner_id);
CREATE TABLE released_handles (
  handle TEXT PRIMARY KEY NOT NULL,
  released_at INTEGER NOT NULL,
  moved_to_kind TEXT CHECK (moved_to_kind IN ('person', 'community')),
  moved_to_id TEXT,
  CHECK ((moved_to_kind IS NULL) = (moved_to_id IS NULL))
);
INSERT INTO handles (handle, owner_kind, owner_id, created_at)
  SELECT handle, 'person', user_id, created_at FROM accounts;
-- A Worker that does not know `handles` (the previous version, during a
-- deploy or after a rollback) still makes accounts. This gives such an
-- account its row here, and fails the account when a community holds the
-- handle. The current Worker writes the row itself first, so it is skipped.
CREATE TRIGGER accounts_handle_shared AFTER INSERT ON accounts
WHEN NOT EXISTS (
  SELECT 1 FROM handles
  WHERE handle = NEW.handle AND owner_kind = 'person' AND owner_id = NEW.user_id
)
BEGIN
  INSERT INTO handles (handle, owner_kind, owner_id, created_at)
    VALUES (NEW.handle, 'person', NEW.user_id, NEW.created_at);
END;

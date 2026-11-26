-- Migration number: 0068 	 2026-11-26T10:00:00.000Z
-- The daily copy of the stored slide files to a second bucket
-- (docs/dev/backup.md). Two tables: what the backup bucket holds, and where
-- the copy has got to. Times are in seconds. Nothing here names a person: a
-- key is an R2 key such as `<deployment id>/<file id>/<lease>`.
--
-- backup_objects: one row for each object the backup bucket holds.
--   key        the R2 key, the same in both buckets
--   etag       the source's etag when it was copied, a source object whose
--              etag differs was put again and is copied again
--   size       the size in bytes, for the operator's counts
--   copied_at  when it was copied
--   gone_at    when a pass first found that the source no longer has it, or
--              NULL while the source has it. The backup keeps the copy for 30
--              days after this, then deletes it and this row.
CREATE TABLE backup_objects (
  key TEXT PRIMARY KEY NOT NULL CHECK (length(key) BETWEEN 1 AND 1024),
  etag TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  copied_at INTEGER NOT NULL,
  gone_at INTEGER
);
-- The copies whose 30 days may have passed, oldest first.
CREATE INDEX backup_objects_gone ON backup_objects (gone_at)
  WHERE gone_at IS NOT NULL;
-- The most recent copy, and the copies of a pass.
CREATE INDEX backup_objects_copied ON backup_objects (copied_at);

-- backup_state: where the copy has got to. One row, id 1.
--   pass_started_at       when the pass in progress started, NULL when none is
--   cursor                the last source key the pass has finished with, in
--                         key order, NULL before its first page, and only a pass
--                         in progress has one
--   last_pass_started_at  when the latest pass started, in progress or not
--   last_completed_at     when the latest pass that finished did, NULL if none
--   progress_at           when a pass last moved on: its cursor advanced or it
--                         finished
--   last_run_at           when the cron task last did something
--   last_run_failed       how many objects, or 1 for a run that stopped on an
--                         error, failed in that run
--   last_failed_at        when a run last had a failure, NULL if none did
--   told_at               when a failure or a stall was last put in the next
--                         day's mail, so that a failure that goes on is told
--                         once a day and not once an hour
CREATE TABLE backup_state (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  pass_started_at INTEGER,
  cursor TEXT,
  last_pass_started_at INTEGER,
  last_completed_at INTEGER,
  progress_at INTEGER,
  last_run_at INTEGER,
  last_run_failed INTEGER NOT NULL DEFAULT 0 CHECK (last_run_failed >= 0),
  last_failed_at INTEGER,
  told_at INTEGER,
  CHECK (cursor IS NULL OR pass_started_at IS NOT NULL)
);
INSERT INTO backup_state (id) VALUES (1);

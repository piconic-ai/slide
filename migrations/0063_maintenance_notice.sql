-- Migration number: 0063 	 2026-11-26T10:00:00.000Z
-- The notice of a planned maintenance (docs/dev/maintenance.md). One row at
-- most: the operator puts the plan in and a new plan replaces the one before
-- (F38-AC6). The band over every page reads it, until the end has passed
-- (F38-AC1, AC4). The secret MAINTENANCE, not this row, holds the service. Times
-- are in seconds. The row holds no address and no person.
--   id          always 1, so that there cannot be a second plan
--   starts_at   when the service is expected to stop
--   ends_at     when it is expected to be back, and after it the band is gone
--   reason      one of the three reasons of src/maintenance/switch.ts
--   updated_at  when the operator put the plan in
CREATE TABLE maintenance_notice (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('database', 'update', 'other')),
  updated_at INTEGER NOT NULL,
  CONSTRAINT maintenance_notice_order CHECK (ends_at > starts_at)
);

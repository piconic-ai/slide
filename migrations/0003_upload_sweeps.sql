-- Migration number: 0003 	 2026-11-06T03:04:50.515Z
-- Records when a closed or ready deployment had its unreferenced R2 objects
-- removed, so the cleanup job visits each deployment once.
ALTER TABLE deployments ADD COLUMN swept_at INTEGER;
-- A failed sweep is retried no earlier than this time, so persistent
-- failures move behind other deployments instead of blocking them.
ALTER TABLE deployments ADD COLUMN sweep_after INTEGER;
CREATE INDEX deployments_unswept ON deployments(swept_at, state);

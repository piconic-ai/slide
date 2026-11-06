-- Migration number: 0003 	 2026-11-06T03:04:50.515Z
-- Records when a closed or ready deployment had its unreferenced R2 objects
-- removed, so the cleanup job visits each deployment once.
ALTER TABLE deployments ADD COLUMN swept_at INTEGER;

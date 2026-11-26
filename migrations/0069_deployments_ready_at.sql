-- Migration number: 0069 	 2026-11-26T12:00:00.000Z
-- The newest public slides are read in the order of the day a version became
-- ready, so the lists on the top page and in the feed of the people a reader
-- follows no longer read every deployment to sort them (docs/dev/scale-cost.md,
-- COST-AC6). The index is on the day alone: one that also names the state is
-- chosen for queries that only filter on the state, and they read the whole
-- table.
CREATE INDEX deployments_ready_at ON deployments (ready_at);

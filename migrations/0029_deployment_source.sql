-- Uploads no longer come from GitHub Actions: a signed-in author starts them
-- from a browser, or an agent through MCP. The columns that named the
-- workflow go, and `source` records where a version was sent from.
--
-- No row is rewritten. `source` has a default only because SQLite needs one
-- to add a NOT NULL column, and every insert passes a value.
ALTER TABLE deployments DROP COLUMN source_sha;
ALTER TABLE deployments DROP COLUMN run_id;
ALTER TABLE deployments DROP COLUMN run_attempt;
ALTER TABLE deployments DROP COLUMN actor_id;
ALTER TABLE deployments DROP COLUMN repository_id;
ALTER TABLE deployments DROP COLUMN owner_id;
ALTER TABLE deployments DROP COLUMN source_ref;
ALTER TABLE deployments ADD COLUMN source TEXT NOT NULL DEFAULT 'browser'
  CHECK (source IN ('browser', 'mcp'));

-- Migration number: 0032 	 2026-11-20T00:00:00.000Z
-- The deployments whose index.html loads the script that tells the viewer
-- which page is on screen (/_preview/pages.js), read once when the upload
-- becomes ready. Only such a deployment has its pages taken as images for
-- link previews. A deployment without a row keeps its cover on every page's
-- URL, as do those made ready before this migration.
--
-- The row goes with its deployment. A later migration that recreates
-- deployments must copy this table aside first, because dropping the parent
-- deletes these rows too.
CREATE TABLE page_script_deployments (
  deployment_id TEXT PRIMARY KEY REFERENCES deployments(id) ON DELETE CASCADE
);

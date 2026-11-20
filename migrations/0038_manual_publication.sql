-- Publication no longer follows a repository: only the author changes it, by
-- hand. The columns that chose the mode, ordered GitHub Actions runs, and
-- let an author's operation outrank a run that started earlier go, and so do
-- the columns in which a workflow asked for a publication.
--
-- No table is rebuilt and no row is rewritten or removed. Each CHECK that
-- names a dropped column belongs to that column, and ci_run_attempt goes
-- before ci_run_id because its CHECK names both.
ALTER TABLE decks DROP COLUMN publication_mode;
ALTER TABLE decks DROP COLUMN author_revision;
ALTER TABLE decks DROP COLUMN ci_run_attempt;
ALTER TABLE decks DROP COLUMN ci_run_id;
ALTER TABLE deployments DROP COLUMN start_revision;
ALTER TABLE deployments DROP COLUMN publish_intent;

-- Migration number: 0006 	 2026-11-06T07:00:00.000Z
-- Publication state of each deck, kept apart from upload state. A deck is a
-- draft, public with one deployment, or paused. public_deployment_id is set
-- only while the deck is public, so it alone decides anonymous delivery. A
-- paused deck remembers in resume_deployment_id what a resume brings back.
-- Every change advances revision, and author operations also copy it into
-- author_revision so CI runs that started earlier cannot override them.
-- Foreign keys cannot require the pointed deployment to be ready and of the
-- same deck, so every write and every delivery check must require both.
ALTER TABLE decks ADD COLUMN publication_mode TEXT NOT NULL DEFAULT 'manual'
  CHECK(publication_mode IN ('manual', 'repository'));
ALTER TABLE decks ADD COLUMN paused_at INTEGER;
ALTER TABLE decks ADD COLUMN public_deployment_id TEXT REFERENCES deployments(id)
  CHECK(public_deployment_id IS NULL OR paused_at IS NULL);
ALTER TABLE decks ADD COLUMN resume_deployment_id TEXT REFERENCES deployments(id)
  CHECK(resume_deployment_id IS NULL OR paused_at IS NOT NULL);
ALTER TABLE decks ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
  CHECK(revision >= 0);
ALTER TABLE decks ADD COLUMN author_revision INTEGER NOT NULL DEFAULT 0
  CHECK(author_revision >= 0 AND author_revision <= revision);
-- The GitHub Actions run that last changed publication in repository mode.
-- GitHub run IDs are unique and increase over time, so they order CI runs.
ALTER TABLE decks ADD COLUMN ci_run_id INTEGER CHECK(ci_run_id >= 0);
ALTER TABLE decks ADD COLUMN ci_run_attempt INTEGER
  CHECK((ci_run_id IS NULL) = (ci_run_attempt IS NULL) AND ci_run_attempt >= 1);

-- The deck revision when the upload started, and the publication the
-- workflow asked for. NULL intent means the workflow did not ask.
ALTER TABLE deployments ADD COLUMN start_revision INTEGER;
ALTER TABLE deployments ADD COLUMN publish_intent TEXT
  CHECK(publish_intent IN ('published', 'unpublished'));

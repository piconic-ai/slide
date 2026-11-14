-- Migration number: 0013 	 2026-11-13T00:00:00.000Z
-- Trial of citations between decks. A citation names one page of the
-- cited deck, or the whole deck as page 0.

-- Links a deployment's HTML makes to share URLs, read once when the
-- deployment becomes ready. They name the target as the link spelled it. A
-- citation counts while its deployment is a deck's public one.
CREATE TABLE citations (
  deployment_id TEXT NOT NULL REFERENCES deployments(id),
  target_handle TEXT NOT NULL,
  target_slug TEXT NOT NULL,
  target_page INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (deployment_id, target_handle, target_slug, target_page),
  CHECK (target_page BETWEEN 0 AND 9999)
);
CREATE INDEX citations_target ON citations (target_handle, target_slug);

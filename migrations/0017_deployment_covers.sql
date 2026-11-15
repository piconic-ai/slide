-- Migration number: 0017 	 2026-11-15T01:00:00.000Z
-- The image a deployment's index.html names in <meta property="og:image">,
-- as the path of one of the deployment's own files, read with the title when
-- the upload becomes ready. Lists show it as the deck's cover, and the
-- viewer offers it to services that preview links. NULL when the entry names
-- none, and for deployments made ready before this migration.
ALTER TABLE deployments ADD COLUMN cover_path TEXT CHECK (
  cover_path IS NULL OR length(cover_path) BETWEEN 1 AND 300
);

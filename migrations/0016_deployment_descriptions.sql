-- Migration number: 0016 	 2026-11-14T01:00:00.000Z
-- The description a deployment's index.html declares in
-- <meta name="description">, read with the title when the upload becomes
-- ready. The viewer shows it and offers it to services that preview links.
-- NULL when the entry declares none, and for deployments made ready before
-- this migration.
ALTER TABLE deployments ADD COLUMN description TEXT CHECK (
  description IS NULL OR length(description) BETWEEN 1 AND 300
);

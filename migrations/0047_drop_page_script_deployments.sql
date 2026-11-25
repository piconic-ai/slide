-- Migration number: 0047 	 2026-11-24T00:00:00.000Z
-- The service now puts the page script into every version's index.html as
-- it serves the file (docs/dev/f03-sharing.md), so every version tells its
-- page and has its pages taken as images. The note of which versions loaded
-- the script themselves is no longer read. Its rows were derived from the
-- stored index.html and say nothing else, so nothing is lost with them.
DROP TABLE page_script_deployments;

-- Migration number: 0020 	 2026-11-16T12:00:00.000Z
-- What a deployment's files exchanged with other hosts, as readers' browsers
-- reported: the kind of exchange, the host and path (never the query), and
-- the page on screen. An empty path is one the browser did not tell. Page -1 is unknown and 0 is while the slides opened.
-- Kind 'seen' is a sighting without a kind, which lends its page to a
-- report of the same URL that carries none. Reports are not authenticated,
-- so every value is validated and a deployment keeps a bounded number.
-- This replaces deployment_hosts, which kept the host alone.
CREATE TABLE deployment_traffic (
  deployment_id TEXT NOT NULL REFERENCES deployments(id),
  kind TEXT NOT NULL CHECK (
    kind IN ('script', 'style', 'image', 'font', 'data', 'frame', 'media', 'other', 'seen')
  ),
  host TEXT NOT NULL CHECK (length(host) BETWEEN 1 AND 253),
  path TEXT NOT NULL CHECK (length(path) BETWEEN 0 AND 200),
  page INTEGER NOT NULL CHECK (page BETWEEN -1 AND 9999),
  first_seen_at INTEGER NOT NULL,
  PRIMARY KEY (deployment_id, kind, host, path, page)
);
DROP TABLE deployment_hosts;

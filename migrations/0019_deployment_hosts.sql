-- Migration number: 0019 	 2026-11-16T00:00:00.000Z
-- Hosts other than its own origin that a deployment's files tried to reach,
-- as readers' browsers reported them through the report-only content policy.
-- The viewer lists them so a reader can see who a slide talks to. Reports
-- are not authenticated, so each host is validated and a deployment keeps a
-- bounded number of them.
CREATE TABLE deployment_hosts (
  deployment_id TEXT NOT NULL REFERENCES deployments(id),
  host TEXT NOT NULL CHECK (length(host) BETWEEN 1 AND 253),
  first_seen_at INTEGER NOT NULL,
  PRIMARY KEY (deployment_id, host)
);

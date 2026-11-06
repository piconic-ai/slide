CREATE TABLE deployments (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  inventory_digest TEXT NOT NULL,
  source_sha TEXT NOT NULL,
  run_id TEXT NOT NULL,
  run_attempt TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('uploading','ready')),
  total_bytes INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  lease_id TEXT,
  lease_until INTEGER,
  ready_at INTEGER
);
CREATE TABLE upload_files (
  deployment_id TEXT NOT NULL REFERENCES deployments(id),
  id TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  media_type TEXT NOT NULL,
  object_key TEXT,
  PRIMARY KEY (deployment_id, id),
  UNIQUE (deployment_id, path)
);

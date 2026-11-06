-- Migration number: 0002 	 2026-11-06T02:41:19.076Z
-- Rebuild deployments to add terminal states, a credential expiry separate
-- from the session expiry, and a failure reason that exists only on failure.
PRAGMA defer_foreign_keys = on;

CREATE TABLE deployments_next (
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
  state TEXT NOT NULL CHECK(state IN ('uploading','ready','failed','expired')),
  total_bytes INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  credential_expires_at INTEGER NOT NULL,
  lease_id TEXT,
  lease_until INTEGER,
  ready_at INTEGER,
  failure_reason TEXT,
  CHECK((state = 'failed') = (failure_reason IS NOT NULL)),
  CHECK((state = 'ready') = (ready_at IS NOT NULL))
);

INSERT INTO deployments_next (
  id, idempotency_key, inventory_digest, source_sha, run_id, run_attempt,
  actor_id, repository_id, owner_id, source_ref, state, total_bytes,
  token_hash, created_at, expires_at, credential_expires_at, lease_id,
  lease_until, ready_at, failure_reason
)
SELECT
  id, idempotency_key, inventory_digest, source_sha, run_id, run_attempt,
  actor_id, repository_id, owner_id, source_ref, state, total_bytes,
  token_hash, created_at, expires_at, expires_at, lease_id, lease_until,
  ready_at, NULL
FROM deployments;

DROP TABLE deployments;
ALTER TABLE deployments_next RENAME TO deployments;

PRAGMA defer_foreign_keys = off;

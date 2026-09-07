-- TITAI v12: fencing tokens and immutable verification attestations
ALTER TABLE durable_jobs ADD COLUMN lease_token INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS verification_attestations (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  requirement_revision TEXT NOT NULL,
  task_revision TEXT NOT NULL,
  source_tree_hash TEXT NOT NULL,
  test_command TEXT NOT NULL,
  test_output_hash TEXT NOT NULL,
  artifact_hash TEXT,
  release_candidate_hash TEXT NOT NULL,
  builder_identity TEXT NOT NULL,
  verifier_identity TEXT NOT NULL,
  status TEXT NOT NULL,
  limitations TEXT NOT NULL DEFAULT '[]',
  evidence_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS verification_attestations_evidence_hash_uq ON verification_attestations(evidence_hash);
CREATE INDEX IF NOT EXISTS verification_attestations_run_idx ON verification_attestations(run_id, created_at);

ALTER TABLE model_profiles ADD COLUMN verification_quality REAL NOT NULL DEFAULT 0.5;
ALTER TABLE model_profiles ADD COLUMN health_state TEXT NOT NULL DEFAULT 'healthy';

ALTER TABLE approvals ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sovereign_key_metadata (
  key_id TEXT PRIMARY KEY NOT NULL,
  purpose TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  tenant_id TEXT,
  workspace_id TEXT,
  status TEXT NOT NULL,
  backend TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS sovereign_key_scope_idx
  ON sovereign_key_metadata(purpose, tenant_id, workspace_id, status);

CREATE TABLE IF NOT EXISTS sovereign_network_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  observed_at INTEGER NOT NULL,
  process_id INTEGER,
  parent_process_id INTEGER,
  executable TEXT,
  protocol TEXT NOT NULL,
  destination_host TEXT,
  destination_ip TEXT,
  destination_port INTEGER,
  policy_mode TEXT NOT NULL,
  decision TEXT NOT NULL,
  tenant_id TEXT,
  workspace_id TEXT,
  run_id TEXT,
  tool_id TEXT,
  sensitive_data_possible INTEGER NOT NULL DEFAULT 0,
  evidence_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sovereign_network_evidence_time_idx
  ON sovereign_network_evidence(observed_at);

CREATE TABLE IF NOT EXISTS sovereign_nodes (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  signing_key_id TEXT NOT NULL,
  trust_state TEXT NOT NULL,
  hardware_profile_json TEXT NOT NULL,
  tenant_scope_json TEXT NOT NULL,
  model_ids_json TEXT NOT NULL,
  tool_ids_json TEXT NOT NULL,
  network_policy TEXT NOT NULL,
  health_state TEXT NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 1
);

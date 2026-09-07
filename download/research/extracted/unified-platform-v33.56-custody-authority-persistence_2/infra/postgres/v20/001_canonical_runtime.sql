BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS missions (
  mission_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  builder_id text NOT NULL,
  scope text NOT NULL,
  effect_key text NOT NULL,
  approval_required boolean NOT NULL,
  approval_status text NOT NULL CHECK (approval_status IN ('NOT_REQUIRED','PENDING','APPROVED')),
  state text NOT NULL CHECK (state IN ('CREATED','WAITING_APPROVAL','READY','EFFECT_PENDING','COMPLETED','CANCELLED','FAILED')),
  revision bigint NOT NULL DEFAULT 0,
  lease_owner text,
  lease_until timestamptz,
  fence_token bigint NOT NULL DEFAULT 0,
  cancelled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, effect_key)
);

CREATE TABLE IF NOT EXISTS approvals (
  approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  mission_id text NOT NULL REFERENCES missions(mission_id),
  reviewer_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  mission_revision bigint NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, mission_id, mission_revision)
);

CREATE TABLE IF NOT EXISTS outbox (
  outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  mission_id text NOT NULL REFERENCES missions(mission_id),
  effect_key text NOT NULL,
  payload_json jsonb NOT NULL,
  payload_digest text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','CLAIMED','DELIVERED')),
  attempt_count integer NOT NULL DEFAULT 0,
  fence_token bigint NOT NULL,
  claimed_by text,
  claimed_until timestamptz,
  created_at timestamptz NOT NULL,
  delivered_at timestamptz,
  UNIQUE (tenant_id, effect_key)
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (created_at) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS effects (
  tenant_id text NOT NULL,
  effect_key text NOT NULL,
  payload_digest text NOT NULL,
  result_json jsonb NOT NULL,
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, effect_key)
);

CREATE TABLE IF NOT EXISTS events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mission_id text NOT NULL REFERENCES missions(mission_id),
  tenant_id text NOT NULL,
  event_type text NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  previous_digest text,
  digest text NOT NULL,
  UNIQUE (mission_id, digest)
);
CREATE INDEX IF NOT EXISTS events_mission_sequence_idx ON events (mission_id, sequence);

CREATE TABLE IF NOT EXISTS evidence (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  record_json jsonb NOT NULL,
  previous_digest text,
  digest text NOT NULL,
  UNIQUE (tenant_id, digest)
);
CREATE INDEX IF NOT EXISTS evidence_tenant_sequence_idx ON evidence (tenant_id, sequence);

CREATE TABLE IF NOT EXISTS revocations (
  revocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  status text NOT NULL,
  reason text NOT NULL,
  effective_at timestamptz NOT NULL,
  approved_by jsonb NOT NULL,
  previous_digest text,
  digest text NOT NULL,
  UNIQUE (tenant_id, target_type, target_id, digest)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  tenant_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_digest text NOT NULL,
  response_json jsonb,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS recovery_checkpoints (
  checkpoint_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  mission_id text NOT NULL REFERENCES missions(mission_id),
  revision bigint NOT NULL,
  state_json jsonb NOT NULL,
  digest text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, mission_id, revision)
);

CREATE OR REPLACE FUNCTION reject_append_only_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append_only_table';
END;
$$;

DROP TRIGGER IF EXISTS events_append_only ON events;
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION reject_append_only_update();
DROP TRIGGER IF EXISTS evidence_append_only ON evidence;
CREATE TRIGGER evidence_append_only BEFORE UPDATE OR DELETE ON evidence FOR EACH ROW EXECUTE FUNCTION reject_append_only_update();
DROP TRIGGER IF EXISTS revocations_append_only ON revocations;
CREATE TRIGGER revocations_append_only BEFORE UPDATE OR DELETE ON revocations FOR EACH ROW EXECUTE FUNCTION reject_append_only_update();

ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_checkpoints ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['missions','approvals','outbox','effects','events','evidence','revocations','idempotency_records','recovery_checkpoints'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      table_name
    );
  END LOOP;
END;
$$;
COMMIT;

-- v20 private-pilot extensions. This block is idempotent when executed after the v19 core.
BEGIN;
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id text PRIMARY KEY,
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  user_id text PRIMARY KEY,
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  tenant_id text NOT NULL REFERENCES tenants(tenant_id),
  user_id text NOT NULL REFERENCES users(user_id),
  roles jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TABLE IF NOT EXISTS private_sessions (
  session_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(tenant_id),
  user_id text NOT NULL REFERENCES users(user_id),
  token_digest text NOT NULL UNIQUE,
  csrf_digest text NOT NULL,
  roles jsonb NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS private_sessions_expiry_idx ON private_sessions(expires_at) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS artifact_records (
  record_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(tenant_id),
  artifact_id text NOT NULL,
  kind text NOT NULL,
  media_type text NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  blob_digest text NOT NULL,
  record_digest text NOT NULL,
  metadata_json jsonb NOT NULL,
  retention text NOT NULL CHECK (retention IN ('standard','long-term','legal-hold')),
  supersedes_record_id text REFERENCES artifact_records(record_id),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revocation_reason text,
  UNIQUE (tenant_id, artifact_id)
);
CREATE INDEX IF NOT EXISTS artifact_records_tenant_created_idx ON artifact_records(tenant_id, created_at);
CREATE TABLE IF NOT EXISTS trust_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id),
  epoch bigint NOT NULL,
  snapshot_json jsonb NOT NULL,
  root text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, epoch),
  UNIQUE (tenant_id, root)
);
CREATE TABLE IF NOT EXISTS action_passports (
  passport_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(tenant_id),
  subject text NOT NULL,
  envelope_json jsonb NOT NULL,
  evidence_root text NOT NULL,
  trust_snapshot_root text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS audit_records (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text,
  actor_id text NOT NULL,
  action text NOT NULL,
  subject_id text,
  occurred_at timestamptz NOT NULL,
  previous_digest text,
  digest text NOT NULL
);

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_passports ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_records ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['memberships','private_sessions','artifact_records','trust_snapshots','action_passports'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      table_name
    );
  END LOOP;
  DROP POLICY IF EXISTS audit_tenant_isolation ON audit_records;
  CREATE POLICY audit_tenant_isolation ON audit_records
    USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true));
END;
$$;

DROP TRIGGER IF EXISTS trust_snapshots_append_only ON trust_snapshots;
CREATE TRIGGER trust_snapshots_append_only BEFORE UPDATE OR DELETE ON trust_snapshots FOR EACH ROW EXECUTE FUNCTION reject_append_only_update();
DROP TRIGGER IF EXISTS audit_records_append_only ON audit_records;
CREATE TRIGGER audit_records_append_only BEFORE UPDATE OR DELETE ON audit_records FOR EACH ROW EXECUTE FUNCTION reject_append_only_update();
COMMIT;

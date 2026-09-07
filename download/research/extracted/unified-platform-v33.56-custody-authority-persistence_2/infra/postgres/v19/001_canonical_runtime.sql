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

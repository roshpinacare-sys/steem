-- PostgreSQL target schema for the next qualified bake-off.
-- This file is not claimed as executed in v17 because PostgreSQL is unavailable.
BEGIN;

CREATE TABLE missions (
  mission_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  builder_id text NOT NULL,
  scope text NOT NULL,
  effect_key text NOT NULL UNIQUE,
  approval_required boolean NOT NULL,
  approval_status text NOT NULL CHECK (approval_status IN ('NOT_REQUIRED','PENDING','APPROVED')),
  state text NOT NULL CHECK (state IN ('CREATED','WAITING_APPROVAL','READY','EFFECT_PENDING','COMPLETED','CANCELLED','FAILED')),
  revision bigint NOT NULL DEFAULT 0,
  lease_owner text,
  lease_until timestamptz,
  fence_token bigint NOT NULL DEFAULT 0,
  cancelled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE outbox (
  outbox_id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(mission_id),
  tenant_id text NOT NULL,
  effect_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','DELIVERED')),
  attempt_count integer NOT NULL DEFAULT 0,
  fence_token bigint NOT NULL,
  created_at timestamptz NOT NULL,
  delivered_at timestamptz
);

CREATE TABLE effects (
  effect_key text PRIMARY KEY,
  tenant_id text NOT NULL,
  payload_digest text NOT NULL,
  result jsonb NOT NULL,
  applied_at timestamptz NOT NULL
);

CREATE TABLE mission_events (
  sequence bigserial PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(mission_id),
  tenant_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  previous_digest text,
  digest text NOT NULL
);

CREATE TABLE evidence_records (
  sequence bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  record jsonb NOT NULL,
  digest text NOT NULL
);

CREATE INDEX outbox_pending_idx ON outbox (created_at) WHERE status = 'PENDING';
CREATE INDEX mission_events_idx ON mission_events (mission_id, sequence);
CREATE INDEX evidence_tenant_idx ON evidence_records (tenant_id, sequence);

COMMIT;

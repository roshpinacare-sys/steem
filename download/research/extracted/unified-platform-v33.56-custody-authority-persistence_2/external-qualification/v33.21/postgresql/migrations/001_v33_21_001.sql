CREATE SCHEMA IF NOT EXISTS governed_crypto;
DO $$
DECLARE v_schema text;
BEGIN
  SELECT n.nspname INTO v_schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto';
  IF v_schema IS NULL THEN
    CREATE EXTENSION pgcrypto WITH SCHEMA governed_crypto;
  ELSIF v_schema <> 'governed_crypto' THEN
    RAISE EXCEPTION 'pgcrypto must be installed in governed_crypto schema, found %', v_schema USING ERRCODE='55000';
  END IF;
END
$$;
CREATE SCHEMA IF NOT EXISTS governed_authority;
CREATE SCHEMA IF NOT EXISTS governed_witness;

CREATE TABLE IF NOT EXISTS governed_authority.schema_migrations (
  migration_id text PRIMARY KEY,
  ordinal integer NOT NULL UNIQUE CHECK (ordinal > 0),
  migration_digest text NOT NULL UNIQUE,
  previous_migration_digest text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS governed_authority.authority_state (
  authority_id text PRIMARY KEY,
  authority_epoch bigint NOT NULL DEFAULT 1 CHECK (authority_epoch > 0),
  fence_counter bigint NOT NULL DEFAULT 0 CHECK (fence_counter >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS governed_authority.leases (
  authority_id text NOT NULL,
  tenant_id text NOT NULL,
  service_id text NOT NULL,
  controller_id text NOT NULL,
  fence_token bigint NOT NULL CHECK (fence_token > 0),
  lease_digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  grant_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (authority_id, tenant_id, service_id),
  FOREIGN KEY (authority_id) REFERENCES governed_authority.authority_state(authority_id)
);

CREATE TABLE IF NOT EXISTS governed_authority.decisions (
  command_id text PRIMARY KEY,
  command_digest text NOT NULL,
  authority_id text NOT NULL,
  tenant_id text NOT NULL,
  service_id text NOT NULL,
  decision_json jsonb NOT NULL,
  decision_digest text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS governed_authority.outbox (
  event_id text PRIMARY KEY,
  event_digest text NOT NULL UNIQUE,
  authority_id text NOT NULL,
  tenant_id text NOT NULL,
  service_id text NOT NULL,
  payload_json jsonb NOT NULL,
  acknowledged_at timestamptz,
  acknowledgement_json jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((acknowledged_at IS NULL) = (acknowledgement_json IS NULL))
);

CREATE TABLE IF NOT EXISTS governed_witness.fences (
  authority_id text NOT NULL,
  tenant_id text NOT NULL,
  service_id text NOT NULL,
  highest_fence_token bigint NOT NULL CHECK (highest_fence_token >= 0),
  witness_receipt_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (authority_id, tenant_id, service_id)
);

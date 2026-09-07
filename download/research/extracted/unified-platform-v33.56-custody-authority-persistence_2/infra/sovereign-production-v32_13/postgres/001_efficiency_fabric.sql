BEGIN;

CREATE TABLE IF NOT EXISTS sovereign_cache_entries (
  tenant_id text NOT NULL,
  cache_key text NOT NULL,
  workload_id text NOT NULL,
  operation text NOT NULL,
  sensitivity text NOT NULL CHECK (sensitivity IN ('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
  source_digest text NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^[0-9a-f]{64}$'),
  authority_digest text NOT NULL CHECK (authority_digest ~ '^[0-9a-f]{64}$'),
  semantic_tokens jsonb NOT NULL,
  result_json jsonb NOT NULL,
  result_digest text NOT NULL CHECK (result_digest ~ '^[0-9a-f]{64}$'),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_access_sequence bigint NOT NULL,
  PRIMARY KEY (tenant_id, cache_key),
  CHECK (expires_at > created_at),
  CHECK (sensitivity <> 'RESTRICTED' OR semantic_tokens = '[]'::jsonb)
);
CREATE INDEX IF NOT EXISTS sovereign_cache_expiry_idx ON sovereign_cache_entries (tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS sovereign_cache_workload_idx ON sovereign_cache_entries (tenant_id, workload_id, operation);

CREATE TABLE IF NOT EXISTS sovereign_work_dedup (
  tenant_id text NOT NULL,
  work_key text NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('CLAIMED','COMPLETED','FAILED')),
  owner_id text NOT NULL,
  fence_token bigint NOT NULL,
  lease_until timestamptz NOT NULL,
  result_json jsonb,
  result_digest text CHECK (result_digest IS NULL OR result_digest ~ '^[0-9a-f]{64}$'),
  evidence_digest text CHECK (evidence_digest IS NULL OR evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, work_key)
);
CREATE INDEX IF NOT EXISTS sovereign_work_claim_idx ON sovereign_work_dedup (tenant_id, state, lease_until);

CREATE TABLE IF NOT EXISTS sovereign_capacity_budgets (
  tenant_id text PRIMARY KEY,
  maximum_active_units integer NOT NULL CHECK (maximum_active_units > 0),
  maximum_daily_units bigint NOT NULL CHECK (maximum_daily_units > 0),
  used_daily_units bigint NOT NULL DEFAULT 0 CHECK (used_daily_units >= 0),
  budget_day date NOT NULL,
  policy_digest text NOT NULL CHECK (policy_digest ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sovereign_cost_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  workload_id text NOT NULL,
  route text NOT NULL CHECK (route IN ('CACHE_EXACT','CACHE_SEMANTIC','LOCAL_RULES','LOCAL_MODEL','LOCAL_ASYNC','BURST_NODE','EXTERNAL_MODEL')),
  event_json jsonb NOT NULL,
  previous_digest text,
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (tenant_id, digest)
);
CREATE INDEX IF NOT EXISTS sovereign_cost_tenant_sequence_idx ON sovereign_cost_events (tenant_id, sequence);

CREATE OR REPLACE FUNCTION reject_sovereign_append_only_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sovereign_append_only_table';
END;
$$;
DROP TRIGGER IF EXISTS sovereign_cost_append_only ON sovereign_cost_events;
CREATE TRIGGER sovereign_cost_append_only BEFORE UPDATE OR DELETE ON sovereign_cost_events FOR EACH ROW EXECUTE FUNCTION reject_sovereign_append_only_change();

ALTER TABLE sovereign_cache_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sovereign_cache_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE sovereign_work_dedup ENABLE ROW LEVEL SECURITY;
ALTER TABLE sovereign_work_dedup FORCE ROW LEVEL SECURITY;
ALTER TABLE sovereign_capacity_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sovereign_capacity_budgets FORCE ROW LEVEL SECURITY;
ALTER TABLE sovereign_cost_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sovereign_cost_events FORCE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['sovereign_cache_entries','sovereign_work_dedup','sovereign_capacity_budgets','sovereign_cost_events'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      table_name
    );
  END LOOP;
END;
$$;

COMMIT;
